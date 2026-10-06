// Test if GraphQL endpoint responds at all
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ENDPOINTS = [
  'https://sc101sc.dev.local/sitecore/api/graph/edge',
  'https://sc101sc.dev.local/sitecore/api/graph/items/master',
  'https://sc101sc.dev.local/sitecore/api/graph',
];

const API_KEY = 'CD43951E-4EC3-4EFE-8998-60031F518F3F';

// Simple introspection query
const query = `{ __schema { queryType { name } } }`;

async function testEndpoint(endpoint) {
  console.log(`\nTesting: ${endpoint}`);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sc_apikey': API_KEY,
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    console.log('  Status:', response.status, response.statusText);
    
    if (response.ok) {
      const text = await response.text();
      console.log('  Response:', text.substring(0, 200));
      return true;
    } else {
      const text = await response.text();
      console.log('  Error:', text.substring(0, 200));
      return false;
    }
    
  } catch (err) {
    console.log('  Failed:', err.message);
    return false;
  }
}

for (const endpoint of ENDPOINTS) {
  await testEndpoint(endpoint);
}
