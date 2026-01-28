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

// 한국수출입은행 전용 fetch (Node.js fetch 사용)
async function fetchKoreaExim(targetUrl) {
  console.log(`[KOREAEXIM] Fetching: ${targetUrl}`);
  
  const response = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
    redirect: 'follow', // 리다이렉트 자동 처리
  });
  
  console.log(`[KOREAEXIM] Status: ${response.status}`);
  const data = await response.text();
  console.log(`[KOREAEXIM] Response length: ${data.length}`);
  console.log(`[KOREAEXIM] First 300 chars: ${data.substring(0, 300)}`);
  
  return {
    statusCode: response.status,
    contentType: response.headers.get('content-type') || 'application/json',
    data: data
  };
}

// UNI-PASS 전용 fetch (포트 38010, SSL 우회)
function fetchUnipass(targetUrl) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 38010,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      rejectUnauthorized: false, // SSL 우회
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      }
    };
    
    console.log(`[UNIPASS] Fetching: ${urlObj.hostname}:${options.port}${urlObj.pathname}`);
    
    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[UNIPASS] Status: ${res.statusCode}, Length: ${data.length}`);
        resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'] || 'application/xml',
          data: data
        });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

// 프록시 엔드포인트
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      usage: '/proxy?url=<encoded_url>'
    });
  }
  
  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  // 허용된 도메인 확인
  const isKoreaExim = urlObj.hostname.includes('koreaexim.go.kr');
  const isUnipass = urlObj.hostname.includes('unipass.customs.go.kr');
  
  if (!isKoreaExim && !isUnipass) {
    return res.status(403).json({ 
      error: 'Domain not allowed',
      allowedDomains: ['koreaexim.go.kr', 'unipass.customs.go.kr']
    });
  }
  
  try {
    let result;
    
    if (isKoreaExim) {
      result = await fetchKoreaExim(targetUrl);
    } else {
      result = await fetchUnipass(targetUrl);
    }
    
    if (!result.data || result.data.length === 0) {
      return res.status(502).json({
        error: 'Empty response from target server',
        statusCode: result.statusCode
      });
    }
    
    res.set('Content-Type', result.contentType);
    res.set('X-Proxy-Status', 'success');
    res.set('X-Target-Domain', isKoreaExim ? 'koreaexim' : 'unipass');
    res.send(result.data);
    
  } catch (error) {
    console.error(`[PROXY] Error: ${error.message}`);
    res.status(500).json({ 
      error: 'Proxy request failed', 
      message: error.message
    });
  }
});

// 루트 경로
app.get('/', (req, res) => {
  res.json({
    name: 'Korean API Proxy',
    version: '1.4.0',
    endpoints: {
      proxy: '/proxy?url=<encoded_url>',
      health: '/health'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Korean API Proxy v1.4.0 running on port ${PORT}`);
});
