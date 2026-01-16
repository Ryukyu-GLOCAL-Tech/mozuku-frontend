import React, { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { signOut, getCurrentUser } from 'aws-amplify/auth';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import HistoryPage from './pages/HistoryPage';
import './index.css';

// Configure Amplify
const amplifyConfig = {
  Auth: {
    Cognito: {
      region: process.env.REACT_APP_COGNITO_REGION,
      userPoolId: process.env.REACT_APP_COGNITO_USER_POOL_ID,
      userPoolClientId: process.env.REACT_APP_COGNITO_CLIENT_ID,
    }
  }
};

Amplify.configure(amplifyConfig);

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('dashboard'); // 'dashboard' or 'history'

  useEffect(() => {
    checkUser();
    
    // Handle browser navigation
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === '/history') {
        setCurrentPage('history');
      } else {
        setCurrentPage('dashboard');
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    handlePopState(); // Set initial page based on URL
    
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const checkUser = async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch (err) {
      console.log('Not authenticated');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setUser(null);
      setCurrentPage('dashboard');
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center">
          <div className="inline-block">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="mt-4 text-gray-600 font-semibold">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {!user ? (
        <LoginPage onUserSignedIn={checkUser} />
      ) : currentPage === 'history' ? (
        <HistoryPage user={user} onSignOut={handleSignOut} />
      ) : (
        <DashboardPage user={user} onSignOut={handleSignOut} />
      )}
    </>
  );
}

export default App;
