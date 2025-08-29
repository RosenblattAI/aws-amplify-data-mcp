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
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

      // Default response for unknown routes
      return new Response(JSON.stringify({
        message: 'AWS Amplify Data MCP Server - Worker Version',
        endpoints: {
          health: '/health',
          graphql: '/api/graphql',
          mcp: '/mcp'
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
  const { method, params } = mcpRequest;

  switch (method) {
    case 'initialize':
      return {
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

    case 'resources/list':
      return {
        resources: [
          {
            uri: "amplify://api-info",
            name: "Amplify API Information",
            description: "Information about the Amplify Data API configuration",
            mimeType: "application/json",
          },
        ],
      };

    case 'resources/read':
      const { uri } = params;
      if (uri === "amplify://api-info") {
        return {
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
      }
      throw new Error(`Unknown resource: ${uri}`);

    case 'tools/list':
      return {
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

    case 'tools/call':
      const { name, arguments: args } = params;
      
      switch (name) {
        case "query_amplify_api":
          return await executeGraphQLQuery(args.query, args.variables || {}, env);

        case "get_api_info":
          return {
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

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

    default:
      throw new Error(`Unknown method: ${method}`);
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
