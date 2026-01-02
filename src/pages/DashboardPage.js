import React from 'react';

export default function DashboardPage({ user, onSignOut }) {
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
                }}>0</p>
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
                }}>0</p>
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
                }}>0%</p>
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
      </main>
    </div>
  );
}
