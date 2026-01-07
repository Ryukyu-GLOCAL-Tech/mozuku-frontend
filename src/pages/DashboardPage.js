import React, { useState, useEffect, useRef } from 'react';

export default function DashboardPage({ user, onSignOut }) {
  const [stats, setStats] = useState({
    totalDetections: 0,
    impuritiesFound: 0,
    detectionRate: '0%'
  });
  const [cameraBringupRunning, setCameraBringupRunning] = useState(false);
  const [sdmBridgeRunning, setSdmBridgeRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelUrl, setModelUrl] = useState('');  // State for S3 model URL
  const [detections, setDetections] = useState([]);
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [loadingDetections, setLoadingDetections] = useState(false);
  const [hasMoreFrames, setHasMoreFrames] = useState(true);
  const [totalFrames, setTotalFrames] = useState(0);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState('');
  const canvasRef = useRef(null);

  useEffect(() => {
    // Load stats when component mounts
    loadStats();
    loadDetections();
    // Refresh stats every 5 seconds
    const interval = setInterval(loadStats, 5000);
    // Don't auto-refresh detections - let user control frame selection
    return () => {
      clearInterval(interval);
    };
  }, []);


  const getAuthToken = () => {
    // Get the last authenticated user ID using the configured Cognito Client ID
    const cognitoClientId = process.env.REACT_APP_COGNITO_CLIENT_ID || 'hga8jtohtcv20lop0djlauqsv';
    const lastAuthUser = localStorage.getItem(`CognitoIdentityServiceProvider.${cognitoClientId}.LastAuthUser`);
    if (!lastAuthUser) return null;
    
    // Construct the idToken key
    const idTokenKey = `CognitoIdentityServiceProvider.${cognitoClientId}.${lastAuthUser}.idToken`;
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
      
      const payload = {
        command: command,
        jobId: jobId
      };
      
      // Add model URL if starting camera and URL is provided
      if ((command === 'start_camera_bringup' || command === 'start_all') && modelUrl.trim()) {
        payload.modelUrl = modelUrl.trim();
      }
      
      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL}/launch-control`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
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

  const loadDetections = async (isLoadMore = false) => {
    try {
      const authToken = getAuthToken();
      if (!authToken) return;

      const offset = isLoadMore ? detections.length : 0;
      const url = `${process.env.REACT_APP_API_BASE_URL}/impurities?userId=${user.username}&limit=50&offset=${offset}&includeFrames=true`;
      console.log('Fetching detections from:', url);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Raw API Response:', JSON.stringify(data, null, 2));
        
        // Handle raw Lambda response format (with statusCode and body)
        let frameData = data;
        if (data.statusCode && data.body) {
          console.warn('Received raw Lambda response format, parsing body...');
          try {
            frameData = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;
            console.log('Parsed body:', JSON.stringify(frameData, null, 2));
          } catch (e) {
            console.error('Failed to parse body:', e);
            return;
          }
        }
        
        // Check if error is in the response
        if (frameData.error) {
          console.error('API returned error:', frameData.error);
          return;
        }
        
        console.log('Detections API Response:', JSON.stringify(frameData, null, 2));
        
        const newFrames = frameData.frames || [];
        if (isLoadMore) {
          // Append new frames to existing list
          setDetections([...detections, ...newFrames]);
        } else {
          // Replace with fresh frames
          setDetections(newFrames);
          // Only set first detection if no selection exists
          if (newFrames.length > 0 && !selectedDetection) {
            console.log('Setting first detection as selected:', newFrames[0]);
            console.log('FRAME DATA STRUCTURE:', JSON.stringify(newFrames[0], null, 2));
            setSelectedDetection(newFrames[0]);
          }
        }
        
        // Update pagination state
        setTotalFrames(frameData.total || 0);
        setHasMoreFrames((newFrames.length + (isLoadMore ? detections.length : 0)) < (frameData.total || 0));
      } else {
        console.error('API Error:', response.status, response.statusText);
        const errorData = await response.json();
        console.error('Error details:', errorData);
      }
    } catch (err) {
      console.error('Error loading detections:', err);
    }
  };

  const loadMoreFrames = () => {
    loadDetections(true);
  };

  // Draw bounding boxes on canvas
  useEffect(() => {
    if (!selectedDetection || !selectedDetection.fullImageUrl || !canvasRef.current) {
      console.log('Canvas effect skipped:', { selectedDetection: !!selectedDetection, fullImageUrl: selectedDetection?.fullImageUrl, canvasRef: !!canvasRef.current });
      return;
    }

    console.log('Drawing frame with detections:', {
      frameId: selectedDetection.frameId,
      imageUrl: selectedDetection.fullImageUrl,
      detectionCount: selectedDetection.detectionCount,
      detections: selectedDetection.detections
    });

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      console.log('Image loaded:', { width: img.width, height: img.height });
      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw the image
      ctx.drawImage(img, 0, 0);
      
      // Draw bounding boxes if detections exist
      const detectionsList = selectedDetection.detections || [];
      console.log('Drawing detections:', detectionsList);
      
      if (detectionsList && detectionsList.length > 0) {
        detectionsList.forEach((detection, idx) => {
          const bbox = detection.bbox;
          console.log(`Detection ${idx}:`, { label: detection.label, bbox, confidence: detection.confidence });
          
          if (bbox && bbox.length >= 4) {
            const [x1, y1, x2, y2] = bbox;
            
            // Draw rectangle
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 3;
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            
            // Draw label background
            ctx.fillStyle = '#ff0000';
            ctx.font = 'bold 14px Arial';
            const label = `${detection.label} ${(detection.confidence * 100).toFixed(1)}%`;
            const textMetrics = ctx.measureText(label);
            ctx.fillRect(x1, y1 - 25, textMetrics.width + 10, 25);
            
            // Draw label text
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, x1 + 5, y1 - 8);
          }
        });
      } else {
        console.log('No detections found in selectedDetection');
      }
    };
    
    img.onerror = (err) => {
      console.error('Failed to load image:', err);
    };
    
    img.crossOrigin = 'anonymous';
    console.log('Setting image src:', selectedDetection.fullImageUrl);
    img.src = selectedDetection.fullImageUrl;
  }, [selectedDetection]);

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

          {/* Model URL Configuration */}
          <div style={{
            backgroundColor: '#f0f9ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '24px'
          }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '8px'
            }}>
              📦 YOLOv8 Model URL (S3 or HTTPS)
            </label>
            <input
              type="text"
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              placeholder="e.g., s3://my-bucket/models/best.pt or https://example.com/best.pt"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
                fontFamily: 'monospace',
                boxSizing: 'border-box',
                marginBottom: '8px'
              }}
            />
            <p style={{
              fontSize: '12px',
              color: '#6b7280',
              margin: 0
            }}>
              💡 Leave empty to use default model (best.pt from package resources)
            </p>
          </div>

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
          
          {/* Detection Selector */}
          {detections && detections.length > 0 && (
            <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f3f4f6', borderRadius: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '8px' }}>
                Select Frame ({detections.length} of {totalFrames} available):
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {detections.map((det, idx) => (
                  <button
                    key={det.frameId}
                    onClick={() => setSelectedDetection(det)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: selectedDetection?.frameId === det.frameId ? '#2563eb' : '#e5e7eb',
                      color: selectedDetection?.frameId === det.frameId ? 'white' : '#374151',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => e.target.style.opacity = '0.8'}
                    onMouseOut={(e) => e.target.style.opacity = '1'}
                  >
                    Frame {idx + 1} ({det.detectionCount || det.detections?.length || 0} {(det.detectionCount || det.detections?.length || 0) === 1 ? 'impurity' : 'impurities'})
                  </button>
                ))}
              </div>
              
              {/* Load More Button */}
              {hasMoreFrames && (
                <button
                  onClick={loadMoreFrames}
                  disabled={loadingDetections}
                  style={{
                    marginTop: '12px',
                    padding: '8px 16px',
                    backgroundColor: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: loadingDetections ? 'not-allowed' : 'pointer',
                    opacity: loadingDetections ? 0.6 : 1,
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => !loadingDetections && (e.target.style.opacity = '0.8')}
                  onMouseOut={(e) => !loadingDetections && (e.target.style.opacity = '1')}
                >
                  {loadingDetections ? '⏳ Loading...' : '📥 Load More Frames'}
                </button>
              )}
            </div>
          )}
          
          {/* Frame Display */}
          <div>
            {/* Full Frame */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                Full Camera Frame with Detections
              </h3>
              <div style={{
                width: '100%',
                maxHeight: '600px',
                backgroundColor: '#f3f4f6',
                borderRadius: '6px',
                border: '2px dashed #d1d5db',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
                fontSize: '14px',
                overflow: 'auto',
                position: 'relative'
              }}>
                {selectedDetection && selectedDetection.fullImageUrl ? (
                  <div style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <canvas
                      ref={canvasRef}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        display: 'block',
                        border: selectedDetection.detections && selectedDetection.detections.length > 0 ? '2px solid #10b981' : 'none',
                        cursor: 'pointer'
                      }}
                      alt="Frame with detections"
                      onClick={() => {
                        if (selectedDetection && selectedDetection.fullImageUrl) {
                          setModalImageUrl(selectedDetection.fullImageUrl);
                          setImageModalOpen(true);
                        }
                      }}
                    />
                    {selectedDetection && (selectedDetection.detections?.length === 0) && (
                      <p style={{ position: 'absolute', bottom: '10px', left: '10px', backgroundColor: 'rgba(0,0,0,0.5)', color: 'white', padding: '5px 10px', borderRadius: '4px', fontSize: '12px', margin: 0 }}>
                        ℹ️ No impurities found
                      </p>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '48px', marginBottom: '8px' }}>📹</div>
                    <p style={{ margin: 0 }}>Waiting for frame data...</p>
                  </div>
                )}
              </div>
              {selectedDetection && (selectedDetection.detections?.length || 0) > 0 && (
                <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
                  ⚠️ {selectedDetection.detections?.length || 0} impurity{(selectedDetection.detections?.length || 0) === 1 ? '' : '(ies)'} detected
                </p>
              )}
              {selectedDetection && (
                <div style={{ marginTop: '8px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                  <p style={{ margin: '0 0 8px 0', fontWeight: '600', color: '#1e40af', fontSize: '13px' }}>Debug Info:</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <p style={{ margin: '0 0 4px 0', color: '#6b7280' }}>Frame ID:</p>
                      <p style={{ margin: 0, color: '#1e40af', fontWeight: '500', wordBreak: 'break-all' }}>{selectedDetection.frameId || 'N/A'}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 4px 0', color: '#6b7280' }}>Impurities:</p>
                      <p style={{ margin: 0, color: '#1e40af', fontWeight: '500' }}>
                        {selectedDetection.detectionCount || selectedDetection.detections?.length || 0}
                      </p>
                    </div>
                  </div>
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #bfdbfe' }}>
                    <p style={{ margin: '0 0 2px 0', color: '#6b7280' }}>Image Status:</p>
                    <p style={{ margin: 0, color: selectedDetection.fullImageUrl ? '#10b981' : '#ef4444', fontWeight: '500' }}>
                      {selectedDetection.fullImageUrl ? '✓ Frame Loaded' : '✗ Frame Not Loaded'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Image Modal Popup */}
      {imageModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={() => setImageModalOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'auto',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setImageModalOpen(false)}
              style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#dc2626'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#ef4444'}
            >
              ✕
            </button>

            {/* Image Title */}
            <h2 style={{ marginTop: 0, marginBottom: '16px', color: '#1f2937', fontSize: '18px' }}>
              Full Resolution Frame
            </h2>

            {/* Image */}
            <img
              src={modalImageUrl}
              alt="Full resolution frame"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                borderRadius: '6px',
                border: '1px solid #e5e7eb'
              }}
            />

            {/* Download Button */}
            <button
              onClick={() => {
                const a = document.createElement('a');
                a.href = modalImageUrl;
                a.download = `frame-${selectedDetection?.frameId?.substring(0, 8) || 'export'}.jpg`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
              style={{
                marginTop: '16px',
                padding: '10px 16px',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#1d4ed8'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#2563eb'}
            >
              ⬇️ Download Image
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
