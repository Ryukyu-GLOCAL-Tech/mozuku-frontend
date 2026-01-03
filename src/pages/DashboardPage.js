import React, { useState, useEffect } from 'react';

export default function DashboardPage({ user, onSignOut }) {
  const [stats, setStats] = useState({
    totalDetections: 0,
    impuritiesFound: 0,
    detectionRate: '0%'
  });
  const [cameraBringupRunning, setCameraBringupRunning] = useState(false);
  const [sdmBridgeRunning, setSdmBridgeRunning] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load stats when component mounts
    loadStats();
    // Refresh stats every 5 seconds
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const getAuthToken = () => {
    // Get the last authenticated user ID
    const lastAuthUser = localStorage.getItem('CognitoIdentityServiceProvider.hga8jtohtcv20lop0djlauqsv.LastAuthUser');
    if (!lastAuthUser) return null;
    
    // Construct the idToken key
    const idTokenKey = `CognitoIdentityServiceProvider.hga8jtohtcv20lop0djlauqsv.${lastAuthUser}.idToken`;
    return localStorage.getItem(idTokenKey);
  };

  const loadStats = async () => {
    try {
      const authToken = getAuthToken();
      if (!authToken) return;

      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL}/stats`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setStats({
          totalDetections: data.totalDetections || 0,
          impuritiesFound: data.impuritiesFound || 0,
          detectionRate: data.detectionRate || '0%'
        });
      }
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  };

  const sendCommand = async (command) => {
    const authToken = getAuthToken();
    if (!authToken) {
      alert('Not authenticated. Please login first.');
      return;
    }

    setLoading(true);
    try {
      const jobId = `job-${Date.now()}`;
      
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL}/launch-control`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command: command,
          jobId: jobId
        })
      });

      if (response.ok) {
        // Update state based on command
        if (command === 'start_all') {
          setCameraBringupRunning(true);
          setSdmBridgeRunning(true);
        } else if (command === 'stop_all') {
          setCameraBringupRunning(false);
          setSdmBridgeRunning(false);
        } else if (command === 'start_camera_bringup') {
          setCameraBringupRunning(true);
        } else if (command === 'stop_camera_bringup') {
          setCameraBringupRunning(false);
        } else if (command === 'start_sdm_bridge') {
          setSdmBridgeRunning(true);
        } else if (command === 'stop_sdm_bridge') {
          setSdmBridgeRunning(false);
        }
      } else {
        const error = await response.json();
        alert(`Error: ${error.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error:', err);
      alert('Failed to send command');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <header style={{
        backgroundColor: 'white',
        borderBottom: '2px solid #2563eb',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        padding: '16px 24px'
      }}>
        <div style={{
          maxWidth: '1280px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '32px' }}>🌾</div>
            <div>
              <h1 style={{
                fontSize: '22px',
                fontWeight: 'bold',
                color: '#1f2937',
                margin: '0 0 4px 0'
              }}>Mozuku</h1>
              <p style={{
                fontSize: '12px',
                color: '#6b7280',
                margin: 0
              }}>Impurity Detection System</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <div style={{
              backgroundColor: '#eff6ff',
              padding: '12px 16px',
              borderRadius: '8px'
            }}>
              <p style={{
                color: '#1f2937',
                fontWeight: '600',
                fontSize: '14px',
                margin: 0
              }}>{user.username}</p>
              <p style={{
                color: '#2563eb',
                fontSize: '12px',
                margin: '4px 0 0 0'
              }}>✓ Authenticated</p>
            </div>
            <button
              onClick={onSignOut}
              style={{
                backgroundColor: '#dc2626',
                color: 'white',
                padding: '8px 16px',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'background-color 0.3s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#b91c1c'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#dc2626'}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '24px 40px'
      }}>
        {/* Stats Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '24px',
          marginBottom: '40px'
        }}>
          {/* Total Detections Card */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            padding: '24px',
            borderLeft: '4px solid #2563eb'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{
                  color: '#6b7280',
                  fontSize: '13px',
                  fontWeight: '600',
                  margin: 0
                }}>Total Detections</p>
                <p style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: '#1f2937',
                  margin: '12px 0 0 0'
                }}>{stats.totalDetections}</p>
              </div>
              <div style={{ fontSize: '32px' }}>📊</div>
            </div>
          </div>

          {/* Impurities Found Card */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            padding: '24px',
            borderLeft: '4px solid #16a34a'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{
                  color: '#6b7280',
                  fontSize: '13px',
                  fontWeight: '600',
                  margin: 0
                }}>Impurities Found</p>
                <p style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: '#1f2937',
                  margin: '12px 0 0 0'
                }}>{stats.impuritiesFound}</p>
              </div>
              <div style={{ fontSize: '32px' }}>⚠️</div>
            </div>
          </div>

          {/* Detection Rate Card */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            padding: '24px',
            borderLeft: '4px solid #ea580c'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{
                  color: '#6b7280',
                  fontSize: '13px',
                  fontWeight: '600',
                  margin: 0
                }}>Detection Rate</p>
                <p style={{
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: '#1f2937',
                  margin: '12px 0 0 0'
                }}>{stats.detectionRate}</p>
              </div>
              <div style={{ fontSize: '32px' }}>🎯</div>
            </div>
          </div>
        </div>

        {/* Welcome Section */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          padding: '24px'
        }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#1f2937',
            marginBottom: '16px',
            marginTop: 0
          }}>Welcome to Mozuku AI</h2>
          <p style={{
            color: '#6b7280',
            lineHeight: '1.6',
            margin: '0 0 16px 0'
          }}>
            Your impurity detection system is running. Connect your ROS2 camera system to start monitoring for impurities in real-time.
          </p>
          <div style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '6px',
            padding: '16px',
            marginTop: '16px'
          }}>
            <p style={{
              color: '#1e40af',
              fontSize: '13px',
              fontWeight: '600',
              margin: 0
            }}>
              📌 Waiting for detection data from ROS2 system...
            </p>
          </div>
        </div>

        {/* ROS2 Launch Files Control */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          padding: '24px',
          marginTop: '24px'
        }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#1f2937',
            marginBottom: '24px',
            marginTop: 0
          }}>🤖 ROS2 Launch Control</h2>

          {/* Launch File 1: Camera Bringup */}
          <div style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
            backgroundColor: cameraBringupRunning ? '#dcfce7' : '#f3f4f6'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>
                📷 Camera Bringup
              </h3>
              <span style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: cameraBringupRunning ? '#22c55e' : '#ef4444'
              }}></span>
            </div>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#6b7280' }}>
              Status: <strong>{cameraBringupRunning ? '🟢 Running' : '🔴 Stopped'}</strong>
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => sendCommand('start_camera_bringup')}
                disabled={cameraBringupRunning || loading}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: cameraBringupRunning ? '#d1d5db' : '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: cameraBringupRunning ? 'not-allowed' : 'pointer',
                  opacity: cameraBringupRunning ? 0.5 : 1
                }}
              >
                ▶️ Start
              </button>
              <button
                onClick={() => sendCommand('stop_camera_bringup')}
                disabled={!cameraBringupRunning || loading}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: !cameraBringupRunning ? '#d1d5db' : '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: !cameraBringupRunning ? 'not-allowed' : 'pointer',
                  opacity: !cameraBringupRunning ? 0.5 : 1
                }}
              >
                ⏹️ Stop
              </button>
            </div>
          </div>

          {/* Launch File 2: SDM Bridge */}
          <div style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
            backgroundColor: sdmBridgeRunning ? '#dcfce7' : '#f3f4f6'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>
                💨 SDM Bridge (Nozzle Control)
              </h3>
              <span style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: sdmBridgeRunning ? '#22c55e' : '#ef4444'
              }}></span>
            </div>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#6b7280' }}>
              Status: <strong>{sdmBridgeRunning ? '🟢 Running' : '🔴 Stopped'}</strong>
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => sendCommand('start_sdm_bridge')}
                disabled={sdmBridgeRunning || loading}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: sdmBridgeRunning ? '#d1d5db' : '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: sdmBridgeRunning ? 'not-allowed' : 'pointer',
                  opacity: sdmBridgeRunning ? 0.5 : 1
                }}
              >
                ▶️ Start
              </button>
              <button
                onClick={() => sendCommand('stop_sdm_bridge')}
                disabled={!sdmBridgeRunning || loading}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: !sdmBridgeRunning ? '#d1d5db' : '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: !sdmBridgeRunning ? 'not-allowed' : 'pointer',
                  opacity: !sdmBridgeRunning ? 0.5 : 1
                }}
              >
                ⏹️ Stop
              </button>
            </div>
          </div>

          {/* Combined Controls */}
          <div style={{
            borderTop: '1px solid #e5e7eb',
            paddingTop: '16px',
            display: 'flex',
            gap: '12px'
          }}>
            <button
              onClick={() => sendCommand('start_all')}
              disabled={loading || (cameraBringupRunning && sdmBridgeRunning)}
              style={{
                flex: 1,
                padding: '10px 16px',
                backgroundColor: (cameraBringupRunning && sdmBridgeRunning) ? '#d1d5db' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: (cameraBringupRunning && sdmBridgeRunning) ? 'not-allowed' : 'pointer',
                opacity: (cameraBringupRunning && sdmBridgeRunning) ? 0.5 : 1
              }}
              onMouseOver={(e) => !((cameraBringupRunning && sdmBridgeRunning) || loading) && (e.target.style.backgroundColor = '#1d4ed8')}
              onMouseOut={(e) => e.target.style.backgroundColor = ((cameraBringupRunning && sdmBridgeRunning) ? '#d1d5db' : '#2563eb')}
            >
              ▶️ Start All
            </button>
            <button
              onClick={() => sendCommand('stop_all')}
              disabled={loading || (!cameraBringupRunning && !sdmBridgeRunning)}
              style={{
                flex: 1,
                padding: '10px 16px',
                backgroundColor: (!cameraBringupRunning && !sdmBridgeRunning) ? '#d1d5db' : '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: (!cameraBringupRunning && !sdmBridgeRunning) ? 'not-allowed' : 'pointer',
                opacity: (!cameraBringupRunning && !sdmBridgeRunning) ? 0.5 : 1
              }}
              onMouseOver={(e) => !((!cameraBringupRunning && !sdmBridgeRunning) || loading) && (e.target.style.backgroundColor = '#b91c1c')}
              onMouseOut={(e) => e.target.style.backgroundColor = ((!cameraBringupRunning && !sdmBridgeRunning) ? '#d1d5db' : '#dc2626')}
            >
              ⏹️ Stop All
            </button>
          </div>
        </div>

        {/* Detection Results Section */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          padding: '24px',
          marginTop: '24px'
        }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#1f2937',
            marginBottom: '16px',
            marginTop: 0
          }}>📷 Detection Results</h2>
          
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
            gap: '20px'
          }}>
            {/* Full Frame */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                Full Camera Frame
              </h3>
              <div style={{
                width: '100%',
                height: '500px',
                backgroundColor: '#f3f4f6',
                borderRadius: '6px',
                border: '2px dashed #d1d5db',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
                fontSize: '14px',
                overflow: 'hidden'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '8px' }}>📹</div>
                  <p style={{ margin: 0 }}>Waiting for frame data...</p>
                </div>
              </div>
            </div>

            {/* Detected Objects */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                Detected Impurities (High Res)
              </h3>
              <div style={{
                width: '100%',
                height: '500px',
                backgroundColor: '#f3f4f6',
                borderRadius: '6px',
                border: '2px dashed #d1d5db',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
                fontSize: '14px',
                overflow: 'auto'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '8px' }}>🔍</div>
                  <p style={{ margin: 0 }}>Detected objects appear here</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>(Cropped & Enhanced Resolution)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
