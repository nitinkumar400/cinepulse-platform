async function verifyBridge() {
  const PORT = 5001; // Default port from backend/server.js
  const url = `http://localhost:${PORT}/api/watch/native/movie/27205`;

  try {
    console.log(`Sending GET request to ${url}...`);
    const response = await fetch(url);
    
    if (response.status !== 200) {
      console.error(`BRIDGE FAIL: HTTP Status ${response.status}`);
      const text = await response.text();
      console.error('Response text:', text);
      return;
    }

    const data = await response.json();

    if (data.success !== true) {
      console.error('BRIDGE FAIL: success is not true in the response body.', data);
      return;
    }

    if (!data.streams || !Array.isArray(data.streams) || data.streams.length === 0) {
      console.error('BRIDGE FAIL: streams array is missing or empty.', data);
      return;
    }

    console.log(`Success! Found ${data.streams.length} streams:`);
    
    data.streams.forEach((stream, index) => {
      console.log(`[Stream ${index + 1}] Provider: ${stream.provider || 'unknown'}`);
      console.log(`          URL: ${stream.url}`);
    });

    console.log('\nBRIDGE PASS: Backend bridge successfully routing microservice streams.');
  } catch (error) {
    console.error('BRIDGE FAIL: Error during fetch.', error);
  }
}

verifyBridge();
