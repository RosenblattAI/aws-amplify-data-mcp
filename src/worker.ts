// Cloudflare Worker entry point for AWS Amplify Data MCP Server
// Simplified version that works with Cloudflare Workers runtime

export interface Env {
  AMPLIFY_API_URL?: string;
  AMPLIFY_API_KEY?: string;
  AMPLIFY_REGION?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

// Worker must export a default handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Cache-Control',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      // Parse the request
      const url = new URL(request.url);
      
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ 
          status: 'healthy',
          worker: 'aws-amplify-data-mcp',
          version: '1.0.0'
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      if (url.pathname === '/api/graphql' && request.method === 'POST') {
        // Proxy GraphQL requests to Amplify
        return await handleGraphQLProxy(request, env);
      }

      if (url.pathname === '/mcp' && request.method === 'POST') {
        // Handle MCP requests
        const body = await request.json();
        const response = await handleMcpRequest(body, env);
        
        return new Response(JSON.stringify(response), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      if (url.pathname === '/sse') {
        if (request.method === 'GET') {
          // Handle SSE connections for MCP
          return handleSSEConnection(request, env);
        } else if (request.method === 'POST') {
          // Handle MCP requests over HTTP on the SSE endpoint
          const body = await request.json();
          const response = await handleMcpRequest(body, env);
          
          return new Response(JSON.stringify(response), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // Handle root path with SSE support
      if (url.pathname === '/' && request.method === 'GET') {
        const accept = request.headers.get('Accept');
        if (accept && accept.includes('text/event-stream')) {
          return handleSSEConnection(request, env);
        }
      }

      // Default response for unknown routes
      return new Response(JSON.stringify({
        message: 'AWS Amplify Data MCP Server - Worker Version',
        endpoints: {
          health: '/health',
          graphql: '/api/graphql',
          mcp: '/mcp',
          sse: '/sse'
        }
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : String(error)
        }), 
        { 
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        }
      );
    }
  },
};

// Handle SSE connections for MCP
async function handleSSEConnection(request: Request, env: Env): Promise<Response> {
  // Check if the client accepts SSE
  const accept = request.headers.get('Accept');
  if (!accept || !accept.includes('text/event-stream')) {
    // If not requesting SSE, return an error in JSON-RPC format
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Invalid Request - SSE transport requires Accept: text/event-stream header"
      },
      id: null
    }), { 
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  // Create SSE response headers
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Accept',
    'Access-Control-Expose-Headers': 'Content-Type',
  });

  // Create a simple SSE stream
  const encoder = new TextEncoder();
  
  // Create response body with initial MCP protocol messages
  const initMessage = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {}
  });

  // Create a streaming response with multiple messages
  const stream = new ReadableStream({
    start(controller) {
      // Send initial message
      controller.enqueue(encoder.encode(`data: ${initMessage}\n\n`));
      
      // Send a ready message
      const readyMessage = JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "info",
          data: "MCP Server ready"
        }
      });
      controller.enqueue(encoder.encode(`data: ${readyMessage}\n\n`));
      
      // Keep connection open for now - close will happen when needed
    }
  });

  return new Response(stream, { headers });
}

// Handle GraphQL proxy requests
async function handleGraphQLProxy(request: Request, env: Env): Promise<Response> {
  const apiUrl = env.AMPLIFY_API_URL;
  const apiKey = env.AMPLIFY_API_KEY;
  
  if (!apiUrl) {
    return new Response(
      JSON.stringify({ error: 'AMPLIFY_API_URL not configured' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const body = await request.text();
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add API key if available
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    // Forward authorization header if present
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body,
    });

    const result = await response.text();
    
    return new Response(result, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error("Error proxying GraphQL request:", error);
    return new Response(
      JSON.stringify({ 
        error: 'GraphQL proxy error',
        message: error instanceof Error ? error.message : String(error)
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Handle MCP protocol requests
async function handleMcpRequest(mcpRequest: any, env: Env) {
  const { method, params, id } = mcpRequest;

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: {
            resources: {},
            tools: {},
          },
          serverInfo: {
            name: 'amplify-data-api-worker',
            version: '1.0.0',
          },
        };
        break;

      case 'resources/list':
        result = {
          resources: [
            {
              uri: "amplify://api-info",
              name: "Amplify API Information",
              description: "Information about the Amplify Data API configuration",
              mimeType: "application/json",
            },
          ],
        };
        break;

      case 'resources/read':
        const { uri } = params;
        if (uri === "amplify://api-info") {
          result = {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify({
                  apiUrl: env.AMPLIFY_API_URL || 'not configured',
                  region: env.AMPLIFY_REGION || 'us-east-1',
                  hasApiKey: !!env.AMPLIFY_API_KEY,
                  status: "configured"
                }, null, 2),
              },
            ],
          };
        } else {
          throw new Error(`Unknown resource: ${uri}`);
        }
        break;
        
      case 'tools/list':
        result = {
          tools: [
            {
              name: "query_amplify_api",
              description: "Execute a GraphQL query against the Amplify Data API",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The GraphQL query to execute",
                  },
                  variables: {
                    type: "object",
                    description: "Variables for the GraphQL query",
                  },
                },
                required: ["query"],
              },
            },
            {
              name: "get_api_info",
              description: "Get information about the Amplify API configuration",
              inputSchema: {
                type: "object",
                properties: {},
              },
            },
          ],
        };
        break;

      case 'tools/call':
        const { name, arguments: args } = params;
        
        switch (name) {
          case "query_amplify_api":
            result = await executeGraphQLQuery(args.query, args.variables || {}, env);
            break;

          case "get_api_info":
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    apiUrl: env.AMPLIFY_API_URL || 'not configured',
                    region: env.AMPLIFY_REGION || 'us-east-1',
                    hasApiKey: !!env.AMPLIFY_API_KEY,
                    worker: 'aws-amplify-data-mcp',
                    version: '1.0.0'
                  }, null, 2),
                },
              ],
            };
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        break;

      default:
        throw new Error(`Unknown method: ${method}`);
    }

    // Return JSON-RPC 2.0 success response
    return {
      jsonrpc: "2.0",
      result: result,
      id: id
    };

  } catch (error) {
    // Return JSON-RPC 2.0 error response
    return {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error)
      },
      id: id
    };
  }
}

// Helper function to execute GraphQL queries
async function executeGraphQLQuery(
  query: string,
  variables: Record<string, any> = {},
  env: Env
): Promise<any> {
  const apiUrl = env.AMPLIFY_API_URL;
  const apiKey = env.AMPLIFY_API_KEY;
  
  if (!apiUrl) {
    return {
      content: [
        {
          type: "text",
          text: "Error: AMPLIFY_API_URL environment variable is not configured",
        },
      ],
      isError: true,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add API key if available
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("Error executing GraphQL query:", error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
