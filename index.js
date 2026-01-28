const express = require('express');
const axios = require('axios');
const https = require('https');
const app = express();

// SSL 인증서 검증 무시하는 axios 인스턴스
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  }),
  timeout: 30000,
  maxRedirects: 10,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, text/xml, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9',
  }
});

// CORS 설정
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 상태 확인
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

// 프록시 엔드포인트
app.get('/proxy', async (req, res) => {
  let targetUrl = req.query.url;
  
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
  const allowedHosts = ['koreaexim.go.kr', 'unipass.customs.go.kr'];
  if (!allowedHosts.some(h => urlObj.hostname.includes(h))) {
    return res.status(403).json({ 
      error: 'Domain not allowed',
      allowedDomains: allowedHosts
    });
  }
  
  // ★★★ 한국수출입은행 URL 자동 변환 (2025.6.25 변경사항) ★★★
  if (urlObj.hostname === 'www.koreaexim.go.kr') {
    targetUrl = targetUrl.replace('www.koreaexim.go.kr', 'oapi.koreaexim.go.kr');
    console.log(`[PROXY] URL converted to new domain: ${targetUrl}`);
  }
  
  try {
    console.log(`[PROXY] Requesting: ${targetUrl}`);
    
    const response = await axiosInstance.get(targetUrl);
    
    console.log(`[PROXY] Status: ${response.status}`);
    console.log(`[PROXY] Data type: ${typeof response.data}`);
    
    // 응답 데이터 처리
    let responseData = response.data;
    let contentType = response.headers['content-type'] || 'application/json';
    
    // 객체/배열인 경우 JSON 문자열로 변환
    if (typeof responseData === 'object') {
      responseData = JSON.stringify(responseData);
      contentType = 'application/json';
    }
    
    console.log(`[PROXY] Response length: ${responseData.length}`);
    
    res.set('Content-Type', contentType);
    res.set('X-Proxy-Status', 'success');
    res.send(responseData);
    
  } catch (error) {
    console.error(`[PROXY] Error:`, error.message);
    
    if (error.response) {
      console.error(`[PROXY] Response status: ${error.response.status}`);
    }
    
    res.status(500).json({ 
      error: 'Proxy request failed', 
      message: error.message,
      code: error.code || 'UNKNOWN'
    });
  }
});

// 루트 경로
app.get('/', (req, res) => {
  res.json({
    name: 'Korean API Proxy',
    version: '2.0.0',
    note: 'Korea Exim Bank URL auto-converted to oapi.koreaexim.go.kr',
    endpoints: {
      proxy: '/proxy?url=<encoded_url>',
      health: '/health'
    },
    allowedDomains: ['koreaexim.go.kr', 'unipass.customs.go.kr']
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Korean API Proxy v2.0.0 running on port ${PORT}`);
});
