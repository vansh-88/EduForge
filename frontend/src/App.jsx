import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

function App() {
  const [healthStatus, setHealthStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/health`);
        console.log('Health check response:', response);
        if (!response.ok) {
          console.log('Health check failed with status:', response.status);
          throw new Error(`Server returned ${response.status}`);
        }
        const message = await response.json().then((data) => data.message);
        setHealthStatus({ success: true, message });
      } catch (err) {
        console.log('Health check error:', err.message);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    checkHealth();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-gray-800">
      <h1 className="text-3xl font-bold mb-6">Backend Wireup Test</h1>

      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-md border border-gray-200">
        <h2 className="text-lg font-semibold mb-3">Endpoint: <code className="text-sm bg-gray-100 px-2 py-1 rounded">/api/health</code></h2>

        {loading && <p className="text-gray-500">Checking backend status...</p>}

        {error && (
          <div className="rounded-lg bg-red-50 p-4 border border-red-200 text-red-700">
            <p className="font-semibold">Connection Failed</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {healthStatus && (
          <div className="rounded-lg bg-green-50 p-4 border border-green-200 text-green-800">
            <p className="font-semibold">Status: {healthStatus.success ? 'Success' : 'Failed'}</p>
            <p className="text-sm mt-1">{healthStatus.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;