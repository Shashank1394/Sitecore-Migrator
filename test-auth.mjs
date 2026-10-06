// Test different authentication methods for /sitecore/api/graph/items/master
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ENDPOINT = 'https://sc101sc.dev.local/sitecore/api/graph/items/master';
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

const authMethods = [
  { name: 'sc_apikey header', headers: { 'sc_apikey': API_KEY } },
  { name: 'X-Scapikey header', headers: { 'X-Scapikey': API_KEY } },
  { name: 'Authorization Bearer', headers: { 'Authorization': `Bearer ${API_KEY}` } },
  { name: 'sc_apikey query param', url: `${ENDPOINT}?sc_apikey=${API_KEY}`, headers: {} },
];

async function testAuth(method) {
  console.log(`\nTesting: ${method.name}`);
  
  try {
    const response = await fetch(method.url || ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...method.headers,
      },
      body: JSON.stringify({ 
        query, 
        variables: { itemId: TEST_ITEM_ID, language: 'en' }
      }),
    });
    
    console.log('  Status:', response.status, response.statusText);
    
    if (response.ok) {
      const json = await response.json();
      if (json.data?.item) {
        console.log('  ✅ SUCCESS!');
        console.log('     Name:', json.data.item.name);
        console.log('     Path:', json.data.item.path);
        return true;
      } else if (json.errors) {
        console.log('  ⚠️  GraphQL Error:', json.errors[0].message);
      } else {
        console.log('  ⚠️  No item found');
      }
    } else {
      const text = await response.text();
      console.log('  ❌ Error:', text.substring(0, 100));
    }
    
  } catch (err) {
    console.log('  ❌ Failed:', err.message);
  }
  
  return false;
}

for (const method of authMethods) {
  const success = await testAuth(method);
  if (success) {
    console.log(`\n🎉 Working authentication method found!`);
    break;
  }
}
