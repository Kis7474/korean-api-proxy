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

// 내부 fetch 함수 (리다이렉트 자동 처리)
function fetchWithRedirect(targetUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }
    
    const urlObj = new URL(targetUrl);
    
    // 한국수출입은행은 HTTP 사용
    let useHttp = urlObj.hostname.includes('koreaexim.go.kr');
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
    
    const options = {
      hostname: urlObj.hostname,
      port: port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      }
    };
    
    console.log(`[FETCH] ${isHttps ? 'HTTPS' : 'HTTP'} ${urlObj.hostname}:${port}${urlObj.pathname}`);
    
    const req = protocol.request(options, (res) => {
      // 리다이렉트 자동 처리
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        
        // 상대 경로인 경우 절대 경로로 변환
        if (redirectUrl.startsWith('/')) {
          const baseProtocol = useHttp ? 'http:' : urlObj.protocol;
          redirectUrl = `${baseProtocol}//${urlObj.hostname}${urlObj.port ? ':' + urlObj.port : ''}${redirectUrl}`;
        }
        
        console.log(`[FETCH] Redirect to: ${redirectUrl}`);
        
        fetchWithRedirect(redirectUrl, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      let data = '';
      res.setEncoding('utf8');
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`[FETCH] Response: ${res.statusCode}, ${data.length} bytes`);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });
    
    req.on('error', (e) => {
      console.error(`[FETCH] Error: ${e.message}`);
      reject(e);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout (30s)'));
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
  
  try {
    const result = await fetchWithRedirect(targetUrl);
    
    if (!result.data || result.data.length === 0) {
      return res.status(502).json({
        error: 'Empty response from target server',
        statusCode: result.statusCode
      });
    }
    
    const contentType = result.headers['content-type'] || 'application/json';
    res.set('Content-Type', contentType);
    res.set('X-Proxy-Status', 'success');
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
    version: '1.3.0',
    features: [
      'Auto redirect handling',
      'HTTP for Korea Exim Bank',
      'HTTPS port 38010 for UNI-PASS'
    ],
    endpoints: {
      proxy: '/proxy?url=<encoded_url>',
      health: '/health'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Korean API Proxy v1.3.0 running on port ${PORT}`);
});
