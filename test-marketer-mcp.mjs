// Test direct connection to Marketer MCP
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const MCP_URL = 'https://marketer.sitecorecloud.io/mcp/marketer-mcp-prod';

console.log('Testing Marketer MCP:', MCP_URL);

// Try a simple GET request to see what auth it needs
async function testConnection() {
  try {
    console.log('\n1. Testing GET request...');
    const getResponse = await fetch(MCP_URL);
    console.log('   Status:', getResponse.status);
    console.log('   Headers:', Object.fromEntries(getResponse.headers.entries()));
    const getText = await getResponse.text();
    console.log('   Body:', getText.substring(0, 300));
  } catch (err) {
    console.error('   Error:', err.message);
  }

  // Try POST with MCP protocol
  try {
    console.log('\n2. Testing MCP tool call...');
    const mcpRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'get_content_item_by_path',
        arguments: {
          itemPath: '/sitecore',
          language: 'en'
        }
      },
      id: 1
    };

    const postResponse = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mcpRequest),
    });

    console.log('   Status:', postResponse.status);
    const postText = await postResponse.text();
    console.log('   Response:', postText.substring(0, 500));
  } catch (err) {
    console.error('   Error:', err.message);
  }

  // Try with session/cookie
  try {
    console.log('\n3. Testing with OPTIONS (CORS preflight)...');
    const optionsResponse = await fetch(MCP_URL, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    console.log('   Status:', optionsResponse.status);
    console.log('   CORS Headers:', {
      'Access-Control-Allow-Origin': optionsResponse.headers.get('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': optionsResponse.headers.get('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': optionsResponse.headers.get('Access-Control-Allow-Headers'),
    });
  } catch (err) {
    console.error('   Error:', err.message);
  }
}

testConnection();
