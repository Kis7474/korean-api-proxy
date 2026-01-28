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
  
  // 한국수출입은행은 HTTP로 강제 (HTTPS가 빈 응답 반환)
  let fetchUrl = targetUrl;
  let useHttp = false;
  
  if (urlObj.hostname.includes('koreaexim.go.kr')) {
    fetchUrl = targetUrl.replace('https://', 'http://');
    useHttp = true;
  }
  
  // 프로토콜 결정
  const isHttps = !useHttp && urlObj.protocol === 'https:';
  const protocol = isHttps ? https : http;
  
  // 포트 결정
  let port;
  if (urlObj.port) {
    port = parseInt(urlObj.port, 10);
  } else if (urlObj.hostname.includes('unipass.customs.go.kr')) {
    port = 38010;
  } else {
    port = isHttps ? 443 : 80;
  }
  
  // URL 재파싱 (HTTP로 변경된 경우)
  const finalUrlObj = new URL(fetchUrl);
  
  const options = {
    hostname: finalUrlObj.hostname,
    port: port,
    path: finalUrlObj.pathname + finalUrlObj.search,
    method: 'GET',
    rejectUnauthorized: false,
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
    }
  };
  
  console.log(`[PROXY] Requesting: ${protocol === https ? 'HTTPS' : 'HTTP'} ${finalUrlObj.hostname}:${port}${finalUrlObj.pathname}`);
  
  const proxyReq = protocol.request(options, (proxyRes) => {
    let data = '';
    proxyRes.setEncoding('utf8');
    
    // 리다이렉트 처리
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      console.log(`[PROXY] Redirect to: ${proxyRes.headers.location}`);
      // 리다이렉트 URL로 다시 요청 (간단히 클라이언트에게 알림)
      return res.status(200).json({
        redirect: true,
        location: proxyRes.headers.location,
        message: 'Redirect detected'
      });
    }
    
    proxyRes.on('data', chunk => {
      data += chunk;
    });
    
    proxyRes.on('end', () => {
      console.log(`[PROXY] Response: ${proxyRes.statusCode}, ${data.length} bytes`);
      console.log(`[PROXY] First 200 chars: ${data.substring(0, 200)}`);
      
      if (data.length === 0) {
        return res.status(502).json({
          error: 'Empty response from target server',
          statusCode: proxyRes.statusCode,
          target: `${finalUrlObj.hostname}:${port}`
        });
      }
      
      const contentType = proxyRes.headers['content-type'] || 'application/json';
      res.set('Content-Type', contentType);
      res.set('X-Proxy-Status', 'success');
      res.set('X-Proxy-Protocol', protocol === https ? 'HTTPS' : 'HTTP');
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
      target: `${finalUrlObj.hostname}:${port}`,
      protocol: protocol === https ? 'HTTPS' : 'HTTP'
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
    version: '1.2.0',
    endpoints: {
      proxy: '/proxy?url=<encoded_url>',
      health: '/health'
    },
    allowedDomains: [
      'www.koreaexim.go.kr (HTTP, port 80)',
      'unipass.customs.go.kr (HTTPS, port 38010)'
    ],
    note: 'Korea Exim Bank API is forced to use HTTP due to HTTPS issues'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Korean API Proxy v1.2.0 running on port ${PORT}`);
});
