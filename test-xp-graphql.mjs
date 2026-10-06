// Test script to verify XP GraphQL connectivity
// Run with: node test-xp-graphql.mjs

import https from 'https';

// Disable SSL verification for self-signed certificates (dev only)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_KEY = 'CD43951E-4EC3-4EFE-8998-60031F518F3F';
const TEST_ITEM_ID = '{04646a89-996f-4ee7-878a-ffdbf1f0ef0d}';

// Different possible GraphQL endpoints for Sitecore
const ENDPOINTS_TO_TRY = [
  'https://sc101sc.dev.local/api/graphqlapi',  // JSS GraphQL (common in 10.x)
  'https://sc101sc.dev.local/sitecore/api/sitecore/v1',  // Services Client
  'https://sc101sc.dev.local/sitecore/api/edge/graphql',  // Original from .env
  'https://sc101sc.dev.local/sitecore/api/graph/items/master',
  'https://sc101sc.dev.local/sitecore/api/graph/edge',
  'https://sc101sc.dev.local/api/sitecore/GraphQL',
  'https://sc101sc.dev.local/api/graphql',
  'https://sc101sc.dev.local/sitecore/api/graph',
];

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
      parent {
        id
      }
    }
  }
`;

const variables = {
  itemId: TEST_ITEM_ID,
  language: 'en'
};

console.log('🔍 Testing XP GraphQL Endpoints');
console.log('🎯 Test Item ID:', TEST_ITEM_ID);
console.log('');

async function testEndpoint(endpoint) {
  console.log(`📍 Testing: ${endpoint}`);
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sc_apikey': API_KEY,
      },
      body: JSON.stringify({ query, variables }),
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);

    if (response.status === 404) {
      console.log(`   ❌ Not Found - This endpoint doesn't exist`);
      return false;
    }

    if (!response.ok) {
      const text = await response.text();
      console.log(`   ❌ Error: ${text.substring(0, 100)}...`);
      return false;
    }

    const json = await response.json();
    
    if (json.errors) {
      console.log(`   ⚠️  GraphQL Errors: ${JSON.stringify(json.errors[0])}`);
      return false;
    }

    if (json.data?.item) {
      console.log(`   ✅ SUCCESS!`);
      console.log(`      Name: ${json.data.item.name}`);
      console.log(`      Path: ${json.data.item.path}`);
      console.log(`      Template: ${json.data.item.template?.name}`);
      return true;
    } else {
      console.log(`   ⚠️  No item in response`);
      return false;
    }

  } catch (err) {
    console.log(`   ❌ Fetch Failed: ${err.message}`);
    return false;
  }
}

async function testAll() {
  for (const endpoint of ENDPOINTS_TO_TRY) {
    const success = await testEndpoint(endpoint);
    console.log('');
    if (success) {
      console.log(`🎉 Working endpoint found: ${endpoint}`);
      console.log(`Update your .env file with:`);
      console.log(`SITECORE_XP_GRAPHQL_ENDPOINT=${endpoint}`);
      break;
    }
  }
}

testAll();
