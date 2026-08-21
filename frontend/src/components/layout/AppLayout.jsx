import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';

export const AppLayout = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
        
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

    </div>
  );
};