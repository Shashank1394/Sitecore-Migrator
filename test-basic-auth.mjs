// Test with Basic Authentication (username/password)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ENDPOINT = 'https://sc101sc.dev.local/sitecore/api/graph/items/master';
const USERNAME = 'sitecore\\admin'; // or just 'admin'
const PASSWORD = 'b';
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

// Create Base64 encoded credentials
const credentials = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

console.log('Testing Basic Authentication');
console.log('Endpoint:', ENDPOINT);
console.log('Username:', USERNAME);

try {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${credentials}`,
    },
    body: JSON.stringify({ 
      query, 
      variables: { itemId: TEST_ITEM_ID, language: 'en' }
    }),
  });
  
  console.log('Status:', response.status, response.statusText);
  
  if (response.ok) {
    const json = await response.json();
    console.log('\n✅ SUCCESS!');
    console.log('Response:', JSON.stringify(json, null, 2));
    
    if (json.data?.item) {
      console.log('\nItem Found:');
      console.log('  ID:', json.data.item.id);
      console.log('  Name:', json.data.item.name);
      console.log('  Path:', json.data.item.path);
      console.log('  Template:', json.data.item.template?.name);
    }
  } else {
    const text = await response.text();
    console.log('\n❌ Error Response:');
    console.log(text.substring(0, 300));
  }
  
} catch (err) {
  console.error('\n❌ Failed:');
  console.error(err.message);
}
