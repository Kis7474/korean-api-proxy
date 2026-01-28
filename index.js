const express = require('express');
const https = require('https');
const http = require('http');
const app = express();

// CORS 설정
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 상태 확인 엔드포인트
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 프록시 엔드포인트
app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      usage: '/proxy?url=<encoded_url>'
    });
  }
  
  // 허용된 도메인 (보안)
  const allowedHosts = [
    'www.koreaexim.go.kr', 
    'koreaexim.go.kr', 
    'unipass.customs.go.kr'
  ];
  
  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  if (!allowedHosts.some(h => urlObj.hostname.includes(h))) {
    return res.status(403).json({ 
      error: 'Domain not allowed',
      allowedDomains: allowedHosts
    });
  }
  
  // HTTPS 또는 HTTP 선택
  const isHttps = urlObj.protocol === 'https:';
  const protocol = isHttps ? https : http;
  
  // 포트 결정 (UNI-PASS는 38010 사용)
  let port;
  if (urlObj.port) {
    port = parseInt(urlObj.port, 10);
  } else if (urlObj.hostname.includes('unipass.customs.go.kr')) {
    port = 38010; // UNI-PASS 기본 포트
  } else {
    port = isHttps ? 443 : 80;
  }
  
  const options = {
    hostname: urlObj.hostname,
    port: port,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    rejectUnauthorized: false, // SSL 인증서 검증 우회 (핵심!)
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Accept-Encoding': 'identity',
    }
  };
  
  console.log(`[PROXY] Requesting: ${urlObj.hostname}:${port}${urlObj.pathname}`);
  
  const proxyReq = protocol.request(options, (proxyRes) => {
    let data = '';
    proxyRes.setEncoding('utf8');
    
    proxyRes.on('data', chunk => {
      data += chunk;
    });
    
    proxyRes.on('end', () => {
      console.log(`[PROXY] Response received: ${data.length} bytes`);
      const contentType = proxyRes.headers['content-type'] || 'text/plain';
      res.set('Content-Type', contentType);
      res.set('X-Proxy-Status', 'success');
      res.set('X-Proxy-Port', port.toString());
      res.send(data);
    });
  });
  
  proxyReq.on('error', (e) => {
    console.error(`[PROXY] Error: ${e.message}`);
    res.status(500).json({ 
      error: 'Proxy request failed', 
      message: e.message,
      code: e.code || 'UNKNOWN',
      target: `${urlObj.hostname}:${port}`
    });
  });
  
  proxyReq.on('timeout', () => {
    console.error('[PROXY] Request timeout');
    proxyReq.destroy();
    res.status(504).json({ error: 'Request timeout (30s)' });
  });
  
  proxyReq.end();
});

// 루트 경로
app.get('/', (req, res) => {
  res.json({
    name: 'Korean API Proxy',
    version: '1.1.0',
    endpoints: {
      proxy: '/proxy?url=<encoded_url>',
      health: '/health'
    },
    allowedDomains: [
      'www.koreaexim.go.kr (port 443)',
      'unipass.customs.go.kr (port 38010)'
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Korean API Proxy v1.1.0 running on port ${PORT}`);
});
