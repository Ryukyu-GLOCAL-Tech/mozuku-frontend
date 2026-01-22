import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';

const buildHttpsUrlFromS3 = (s3Url) => {
  if (!s3Url || typeof s3Url !== 'string' || !s3Url.startsWith('s3://')) return s3Url;
  const parts = s3Url.replace('s3://', '').split('/', 2);
  const bucket = parts[0];
  const key = parts[1] || '';
  const region = process.env.REACT_APP_COGNITO_REGION || 'ap-northeast-1';
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
};

const getFrameLabelsUrl = (frame) => {
  if (!frame) return '';
  if (frame.s3LabelsPath) return buildHttpsUrlFromS3(frame.s3LabelsPath);

  const source = frame.s3UrlWithoutBbox || frame.fullImageUrlWithoutBbox || frame.fullImageUrl || '';
  if (!source) return '';

  const https = buildHttpsUrlFromS3(source);
  const base = https.split('?')[0];
  return base.replace(/\.(jpg|jpeg|png)$/i, '.txt');
};

const parseBboxText = (text) => {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).map(Number))
    .filter((arr) => arr.length >= 5 && arr.every((n) => Number.isFinite(n)))
    .map(([cls, x, y, w, h]) => ({ cls, x, y, w, h }));
};

const getFrameImageUrl = (frame) => {
  if (!frame) return '';
  
  // Use frame WITHOUT bbox - we will draw red bboxes on clean frame
  console.log('🔍 Frame URL fields available:', {
    fullImageUrlWithoutBbox: !!frame.fullImageUrlWithoutBbox,
    s3UrlWithoutBbox: !!frame.s3UrlWithoutBbox,
    fullImageUrl: !!frame.fullImageUrl
  });
  
  // Use frame WITHOUT bbox so we can draw detection bboxes on it
  let chosen = frame.fullImageUrlWithoutBbox || frame.s3UrlWithoutBbox || frame.fullImageUrl || '';
  
  console.log('✅ Using clean frame WITHOUT bbox:', chosen?.substring(0, 80) + '...');
  
  return buildHttpsUrlFromS3(chosen);
};

export default function DashboardPage({ user, onSignOut }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState({
    totalDetections: 0,
    impuritiesFound: 0,
    detectionRate: '0%',
    overallAccuracy: '0%',
    verifiedFrames: 0,
    totalFrames: 0
  });
  const [todayStats, setTodayStats] = useState({
    totalDetections: 0,
    impuritiesFound: 0,
    detectionRate: '0%',
    overallAccuracy: '0%',
    verifiedFrames: 0
  });
  const [currentSession, setCurrentSession] = useState(null);
  const [cameraBringupRunning, setCameraBringupRunning] = useState(false);
  const [sdmBridgeRunning, setSdmBridgeRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelUrl, setModelUrl] = useState('');  // State for S3 model URL
  const [detections, setDetections] = useState([]);
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [hasMoreFrames, setHasMoreFrames] = useState(true);
  const [totalFrames, setTotalFrames] = useState(0);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState('');
  const [selectedImageUrl, setSelectedImageUrl] = useState('');
  const [selectedBboxes, setSelectedBboxes] = useState([]);
  const canvasRef = useRef(null);

  useEffect(() => {
    // Load stats when component mounts
    loadStats();
    loadCurrentSession();
    loadDetections();
    
    // Refresh stats every 5 seconds
    const statsInterval = setInterval(() => {
      loadStats();
      loadCurrentSession();
    }, 5000);
    
    // Auto-refresh detections every 3 seconds to show new frames immediately
    const detectionsInterval = setInterval(() => {
      loadDetections(false);
    }, 3000);
    
    return () => {
      clearInterval(statsInterval);
      clearInterval(detectionsInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update image URL when selectedDetection changes
  useEffect(() => {
    let isActive = true;
    if (selectedDetection) {
      const imageUrl = getFrameImageUrl(selectedDetection);
      setSelectedImageUrl(imageUrl);

      const labelsUrl = getFrameLabelsUrl(selectedDetection);
      if (!labelsUrl) {
        setSelectedBboxes([]);
        return () => { isActive = false; };
      }

      fetch(labelsUrl)
        .then((res) => res.text())
        .then((text) => {
          if (!isActive) return;
          const parsed = parseBboxText(text);
          setSelectedBboxes(parsed);
        })
        .catch((err) => {
          console.error('❌ Failed to load bbox labels:', err);
          if (isActive) setSelectedBboxes([]);
        });
    }
    return () => { isActive = false; };
  }, [selectedDetection]);

  // Draw detection bboxes on canvas from extracted coordinates
  useEffect(() => {
    if (!canvasRef.current || !selectedDetection || !selectedImageUrl) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw the clean frame
      ctx.drawImage(img, 0, 0);
      
      // Draw red bboxes using YOLO labels from txt file
      if (selectedBboxes.length > 0) {
        let bboxCount = 0;
        selectedBboxes.forEach(({ x, y, w, h }) => {
          // YOLO normalized -> pixel coords
          const x1 = (x - w / 2) * canvas.width;
          const y1 = (y - h / 2) * canvas.height;
          const x2 = (x + w / 2) * canvas.width;
          const y2 = (y + h / 2) * canvas.height;
          ctx.strokeStyle = '#ff0000';
          ctx.lineWidth = 3;
          ctx.rect(x1, y1, x2 - x1, y2 - y1);
          ctx.stroke();
          bboxCount++;
        });
        
        console.log(`✅ Drew ${bboxCount} red bboxes on canvas`);
      }
    };
    
    img.onerror = () => {
      console.error('❌ Failed to load image for canvas drawing:', selectedImageUrl);
    };
    
    img.src = selectedImageUrl;
  }, [selectedImageUrl, selectedBboxes, selectedDetection]);


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

      // Load overall stats from session history (using existing GetDetectionHistory endpoint)
      const params = new URLSearchParams({
        userId: user.username,
        page: 1,
        limit: 100  // Get more to calculate accuracy
      });

      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL}/detection-history?${params}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        
        // Calculate accuracy from verified frames
        let totalF1 = 0;
        let verifiedCount = 0;
        let totalFramesCount = 0;
        let todayVerifiedCount = 0;
        let todayTotalF1 = 0;

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startOfDayTime = startOfDay.getTime();

        if (data.sessions && data.sessions.length > 0) {
          data.sessions.forEach(session => {
            if (session.frames) {
              session.frames.forEach(frame => {
                totalFramesCount++;

                // If verified, add to accuracy calculation
                if (frame.labelingStatus === 'verified' && frame.labelingMetrics) {
                  totalF1 += frame.labelingMetrics.f1_score || 0;
                  verifiedCount++;
                  
                  if (frame.timestamp >= startOfDayTime) {
                    todayVerifiedCount++;
                    todayTotalF1 += frame.labelingMetrics.f1_score || 0;
                  }
                }
              });
            }
          });
        }

        const overallAccuracy = verifiedCount > 0 ? Math.round((totalF1 / verifiedCount) * 100) : 0;
        const todayAccuracy = todayVerifiedCount > 0 ? Math.round((todayTotalF1 / todayVerifiedCount) * 100) : 0;
        
        // Set overall stats
        if (data.overallStats) {
          setStats({
            totalDetections: data.overallStats.totalDetections || 0,
            impuritiesFound: data.overallStats.totalImpurities || 0,
            detectionRate: `${data.overallStats.avgDetectionRate || 0}%`,
            overallAccuracy: `${overallAccuracy}%`,
            verifiedFrames: verifiedCount,
            totalFrames: totalFramesCount
          });
        }
        
        // Set today's stats
        if (data.todayStats) {
          setTodayStats({
            totalDetections: data.todayStats.totalDetections || 0,
            impuritiesFound: data.todayStats.totalImpurities || 0,
            detectionRate: `${data.todayStats.avgDetectionRate || 0}%`,
            overallAccuracy: `${todayAccuracy}%`,
            verifiedFrames: todayVerifiedCount
          });
        }
      }
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  };

  const loadCurrentSession = async () => {
    try {
      const authToken = getAuthToken();
      if (!authToken) return;

      // Get active sessions from detection history
      const params = new URLSearchParams({
        userId: user.username,
        status: 'active',
        limit: 1
      });

      const response = await fetch(`${process.env.REACT_APP_API_BASE_URL}/detection-history?${params}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.sessions && data.sessions.length > 0) {
          setCurrentSession(data.sessions[0]);
        } else {
          setCurrentSession(null);
        }
      }
    } catch (err) {
      console.error('Error loading current session:', err);
    }
  };



  const sendCommand = async (command) => {
    const authToken = getAuthToken();
    if (!authToken) {
      alert(t('common.notAuthenticated'));
      return;
    }

    setLoading(true);
    try {
      const jobId = `job-${Date.now()}`;
      
      const payload = {
        command: command,
        jobId: jobId,
        userId: user.username  // Send the actual Cognito username
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
        alert(`${t('common.errorPrefix')}: ${error.message || t('common.unknownError')}`);
      }
    } catch (err) {
      console.error('Error:', err);
      alert(t('common.failedToSendCommand'));
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

  // Draw bounding boxes on canvas - DISABLED
  // We now use frame-with-bbox from yolov8 which already has accurate bboxes drawn
  // No need to draw our own canvas bboxes - this avoids mismatches

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
              }}>{t('dashboard.title')}</h1>
              <p style={{
                fontSize: '12px',
                color: '#6b7280',
                margin: 0
              }}>{t('dashboard.statsOverall')}</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <LanguageSwitcher />
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
              }}>✓ {t('common.authenticated')}</p>
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
              {t('nav.logout')}
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
        {/* History Link and Session Controls */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <a 
            href="/history"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, '', '/history');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              color: '#3b82f6',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: '600',
              padding: '10px 16px',
              backgroundColor: '#eff6ff',
              borderRadius: '8px',
              transition: 'all 0.3s',
              cursor: 'pointer'
            }}
            onMouseOver={(e) => {
              e.target.style.backgroundColor = '#dbeafe';
            }}
            onMouseOut={(e) => {
              e.target.style.backgroundColor = '#eff6ff';
            }}
          >
            📜 {t('history.viewDetails')}
          </a>

          {/* Session Controls */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {currentSession ? (
              <div style={{
                padding: '8px 16px',
                backgroundColor: '#10b98120',
                color: '#10b981',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{ 
                  width: '8px', 
                  height: '8px', 
                  backgroundColor: '#10b981',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'pulse 2s ease-in-out infinite'
                }}></span>
                {t('dashboard.activeSessions')}
              </div>
            ) : (
              <div style={{
                padding: '8px 16px',
                backgroundColor: '#6b728020',
                color: '#6b7280',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600'
              }}>
                {t('dashboard.noActiveSession')}
              </div>
            )}
          </div>
        </div>

        {/* Overall Stats Section */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#1f2937',
            margin: '0 0 16px 0'
          }}>📊 {t('dashboard.statsOverall')}</h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px'
          }}>
            <StatItem label={t('dashboard.totalDetections')} value={stats.totalDetections} />
            <StatItem label={t('dashboard.impuritiesFound')} value={stats.impuritiesFound} />
            <StatItem label={t('dashboard.detectionRate')} value={stats.detectionRate} />
            <StatItem label="Manual Accuracy" value={stats.overallAccuracy} />
            <StatItem label="Verified Frames" value={`${stats.verifiedFrames}/${stats.totalFrames}`} />
          </div>
        </div>

        {/* Today's Stats Section */}
        {todayStats.totalDetections > 0 && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            padding: '20px',
            marginBottom: '24px',
            borderLeft: '4px solid #10b981'
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: 'bold',
              color: '#10b981',
              margin: '0 0 16px 0'
            }}>🌟 {t('dashboard.statsToday')}</h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px'
            }}>
              <StatItem label={t('history.detections')} value={todayStats.totalDetections} />
              <StatItem label={t('history.impurities')} value={todayStats.impuritiesFound} />
              <StatItem label={t('history.rate')} value={todayStats.detectionRate} />
              <StatItem label="Today Accuracy" value={todayStats.overallAccuracy} />
              <StatItem label="Verified Today" value={todayStats.verifiedFrames} />
            </div>
          </div>
        )}

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
                }}>{t('dashboard.totalDetections')}</p>
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
                }}>{t('dashboard.impuritiesFound')}</p>
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
                }}>{t('dashboard.detectionRate')}</p>
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
          }}>{t('dashboard.welcome')}</h2>
          <p style={{
            color: '#6b7280',
            lineHeight: '1.6',
            margin: '0 0 16px 0'
          }}>
            {t('dashboard.description')}
          </p>
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
          }}>🤖 {t('dashboard.ros2Control')}</h2>

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
              📦 {t('dashboard.modelUrl')}
            </label>
            <input
              type="text"
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              placeholder={t('dashboard.modelUrlPlaceholder')}
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
              💡 {t('dashboard.modelUrlHint')}
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
                📷 {t('dashboard.cameraBringup')}
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
              {t('dashboard.status')}: <strong>{cameraBringupRunning ? `🟢 ${t('dashboard.running')}` : `🔴 ${t('dashboard.stopped')}`}</strong>
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
                ▶️ {t('dashboard.start')}
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
                ⏹️ {t('dashboard.stop')}
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
                💨 {t('dashboard.nozzleControl')}
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
              {t('dashboard.status')}: <strong>{sdmBridgeRunning ? `🟢 ${t('dashboard.running')}` : `🔴 ${t('dashboard.stopped')}`}</strong>
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
                ▶️ {t('dashboard.start')}
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
                ⏹️ {t('dashboard.stop')}
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
              ▶️ {t('dashboard.startAll')}
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
              ⏹️ {t('dashboard.stopAll')}
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
          }}>📷 {t('dashboard.detectionResults')}</h2>
          
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
                    Frame {idx + 1} ({det.frameId === selectedDetection?.frameId ? (selectedBboxes.length || det.detectionCount || det.detections?.length || 0) : (det.detectionCount || det.detections?.length || 0)} {(det.frameId === selectedDetection?.frameId ? (selectedBboxes.length || det.detectionCount || det.detections?.length || 0) : (det.detectionCount || det.detections?.length || 0)) === 1 ? 'impurity' : 'impurities'})
                  </button>
                ))}
              </div>
              
              {/* Load More Button */}
              {hasMoreFrames && (
                <button
                  onClick={loadMoreFrames}
                  style={{
                    marginTop: '12px',
                    padding: '8px 16px',
                    backgroundColor: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    opacity: 1,
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => (e.target.style.opacity = '0.8')}
                  onMouseOut={(e) => (e.target.style.opacity = '1')}
                >
                  📥 Load More Frames
                </button>
              )}
            </div>
          )}
          
          {/* Frame Display */}
          <div>
            {/* Full Frame */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                {t('dashboard.fullFrame')}
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
                {selectedDetection && selectedImageUrl ? (
                  <div style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <canvas
                      ref={canvasRef}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        display: 'block',
                        border: selectedDetection.detectionCount && selectedDetection.detectionCount > 0 ? '2px solid #10b981' : '2px solid #d1d5db',
                        cursor: 'pointer',
                        borderRadius: '4px'
                      }}
                      alt="Frame with detections"
                      onClick={() => {
                        if (selectedDetection && selectedImageUrl) {
                          setModalImageUrl(selectedImageUrl);
                          setImageModalOpen(true);
                        }
                      }}
                    />
                    {selectedDetection && selectedDetection.detectionCount === 0 && (
                      <p style={{ position: 'absolute', bottom: '10px', left: '10px', backgroundColor: 'rgba(0,0,0,0.5)', color: 'white', padding: '5px 10px', borderRadius: '4px', fontSize: '12px', margin: 0 }}>
                        ℹ️ No impurities found
                      </p>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '48px', marginBottom: '8px' }}>📹</div>
                    <p style={{ margin: 0 }}>{t('dashboard.waitingForFrame')}</p>
                  </div>
                )}
              </div>
              {selectedDetection && (selectedDetection.detectionCount || 0) > 0 && (
                <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
                  ⚠️ {selectedDetection.detectionCount} impurity{selectedDetection.detectionCount === 1 ? '' : '(ies)'} detected
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
                    <p style={{ margin: 0, color: selectedImageUrl ? '#10b981' : '#ef4444', fontWeight: '500' }}>
                      {selectedImageUrl ? '✓ Frame Loaded' : '✗ Frame Not Loaded'}
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

// Helper component for stat items
function StatItem({ label, value }) {
  return (
    <div style={{
      padding: '12px',
      backgroundColor: '#f9fafb',
      borderRadius: '6px'
    }}>
      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937' }}>
        {value}
      </div>
    </div>
  );
}
