// Quick test for a specific endpoint
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ENDPOINT = 'https://sc101sc.dev.local/sitecore/api/graph/edge';
const API_KEY = 'CD43951E-4EC3-4EFE-8998-60031F518F3F';
const TEST_ITEM_ID = '{04646a89-996f-4ee7-878a-ffdbf1f0ef0d}';

const query = `
  query GetItemById($itemId: String!, $language: String!) {
    item(path: $itemId, language: $language) {
      id
      name
      path
      template {
        id
        name
      }
    }
  }
`;

console.log('Testing:', ENDPOINT);

try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'sc_apikey': API_KEY,
    },
    body: JSON.stringify({ 
      query, 
      variables: { itemId: TEST_ITEM_ID, language: 'en' }
    }),
    signal: controller.signal,
  });
  
  clearTimeout(timeout);
  
  console.log('Status:', response.status);
  
  const json = await response.json();
  console.log('Response:', JSON.stringify(json, null, 2));
  
} catch (err) {
  console.error('Error:', err.message);
}
