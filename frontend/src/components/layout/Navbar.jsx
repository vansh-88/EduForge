import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export const Navbar = () => {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  // Helper function to handle NavLink active styling
  const navLinkClass = ({ isActive }) =>
    isActive
      ? 'text-blue-600 font-semibold border-b-2 border-blue-600 pb-1'
      : 'text-gray-600 hover:text-blue-600 pb-1';

  const mobileNavLinkClass = ({ isActive }) =>
    isActive
      ? 'block px-4 py-2 text-blue-600 font-semibold bg-blue-50'
      : 'block px-4 py-2 text-gray-600 hover:bg-gray-100';

  return (
    <nav className="bg-white shadow-md relative z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Left side: Logo & Desktop Links */}
          <div className="flex items-center">
            {/* Logo */}
            <Link to="/dashboard" className="shrink-0 flex items-center">
              <span className="text-xl font-bold text-gray-900">EduForge</span>
            </Link>

            {/* Desktop Nav Links */}
            <div className="hidden md:ml-8 md:flex md:space-x-8">
              <NavLink to="/dashboard" className={navLinkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/courses" className={navLinkClass}>
                My Courses
              </NavLink>
              <NavLink to="/generate" className={navLinkClass}>
                Generate
              </NavLink>
            </div>
          </div>

          {/* Right side: Profile & Mobile Menu Button */}
          <div className="flex items-center">
            {/* Desktop Profile Dropdown */}
            <div className="relative ml-3 hidden md:block">
              <button
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className="flex items-center text-sm font-medium text-gray-700 hover:text-gray-900 focus:outline-none"
              >
                {user?.name || 'User'}
                {/* Simple dropdown arrow */}
                <svg className="ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isProfileMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 border border-gray-200">
                  <Link
                    to="/profile"
                    onClick={() => setIsProfileMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Profile
                  </Link>
                  <button
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      logout();
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>

            {/* Mobile menu button (Hamburger) */}
            <div className="flex items-center md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none"
              >
                <span className="sr-only">Open main menu</span>
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {isMobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu Panel */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-gray-200">
          <div className="pt-2 pb-3 space-y-1">
            <NavLink
              to="/dashboard"
              onClick={() => setIsMobileMenuOpen(false)}
              className={mobileNavLinkClass}
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/courses"
              onClick={() => setIsMobileMenuOpen(false)}
              className={mobileNavLinkClass}
            >
              My Courses
            </NavLink>
            <NavLink
              to="/generate"
              onClick={() => setIsMobileMenuOpen(false)}
              className={mobileNavLinkClass}
            >
              Generate
            </NavLink>
          </div>
          
          {/* Mobile Profile Section */}
          <div className="pt-4 pb-3 border-t border-gray-200">
            <div className="px-4 flex items-center">
              <div className="text-base font-medium text-gray-800">{user?.name}</div>
            </div>
            <div className="mt-3 space-y-1">
              <Link
                to="/profile"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-4 py-2 text-base font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100"
              >
                Profile
              </Link>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  logout();
                }}
                className="block w-full text-left px-4 py-2 text-base font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};