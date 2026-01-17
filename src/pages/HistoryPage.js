import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../components/LanguageSwitcher';
import BboxAnnotator from '../components/BboxAnnotator';

export default function HistoryPage({ user, onSignOut }) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [overallStats, setOverallStats] = useState(null);
  const [todayStats, setTodayStats] = useState(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalSessions: 0,
    hasNext: false,
    hasPrev: false
  });
  
  // Filters
  const [currentPage, setCurrentPage] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('startTime');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // Selected session for details view
  const [selectedSession, setSelectedSession] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [sessionFrames, setSessionFrames] = useState([]);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  
  // Labeling state
  const [isEditingLabels, setIsEditingLabels] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);
  
  // Feedback state
  const [feedbackData, setFeedbackData] = useState({});
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, startDate, endDate, statusFilter, sortBy, sortOrder]);

  const getAuthToken = () => {
    const cognitoClientId = process.env.REACT_APP_COGNITO_CLIENT_ID || 'hga8jtohtcv20lop0djlauqsv';
    const lastAuthUser = localStorage.getItem(`CognitoIdentityServiceProvider.${cognitoClientId}.LastAuthUser`);
    if (!lastAuthUser) return null;
    
    const idTokenKey = `CognitoIdentityServiceProvider.${cognitoClientId}.${lastAuthUser}.idToken`;
    return localStorage.getItem(idTokenKey);
  };

  const loadHistory = async () => {
    setLoading(true);
    try {
      const authToken = getAuthToken();
      if (!authToken) return;

      // Build query parameters
      const params = new URLSearchParams({
        userId: user.userId,
        page: currentPage,
        limit: 20,
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      if (startDate) params.append('startDate', new Date(startDate).getTime());
      if (endDate) params.append('endDate', new Date(endDate).getTime());
      if (statusFilter) params.append('status', statusFilter);

      const response = await fetch(
        `${process.env.REACT_APP_API_BASE_URL}/detection-history?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
        setPagination(data.pagination || {});
        setOverallStats(data.overallStats || null);
        setTodayStats(data.todayStats || null);
      } else {
        console.error('Failed to load history');
      }
    } catch (err) {
      console.error('Error loading history:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  const handleResetFilters = () => {
    setStartDate('');
    setEndDate('');
    setStatusFilter('');
    setSortBy('startTime');
    setSortOrder('desc');
    setCurrentPage(1);
  };

  const handleViewDetails = async (session) => {
    setSelectedSession(session);
    setShowDetailsModal(true);
    setCurrentFrameIndex(0);
    await loadSessionFrames(session.sessionId);
  };

  const loadSessionFrames = async (sessionId) => {
    setLoadingFrames(true);
    try {
      const authToken = getAuthToken();
      if (!authToken) return;

      const response = await fetch(
        `${process.env.REACT_APP_API_BASE_URL}/detection-history?userId=${user.userId}&sessionId=${sessionId}`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setSessionFrames(data.frames || []);
      } else {
        console.error('Failed to load session frames');
      }
    } catch (err) {
      console.error('Error loading session frames:', err);
    } finally {
      setLoadingFrames(false);
    }
  };

  const handleNextFrame = () => {
    if (currentFrameIndex < sessionFrames.length - 1) {
      setCurrentFrameIndex(currentFrameIndex + 1);
    }
  };

  const handlePrevFrame = () => {
    if (currentFrameIndex > 0) {
      setCurrentFrameIndex(currentFrameIndex - 1);
    }
  };
  
  const handleSaveLabels = async (corrections) => {
    setSavingLabels(true);
    try {
      const authToken = getAuthToken();
      if (!authToken) {
        alert(t('labeling.saveError') + ': No authentication token found. Please login again.');
        setSavingLabels(false);
        return;
      }

      const currentFrame = sessionFrames[currentFrameIndex];
      if (!currentFrame) {
        alert(t('labeling.saveError') + ': No frame selected');
        setSavingLabels(false);
        return;
      }
      
      const response = await fetch(
        `${process.env.REACT_APP_API_BASE_URL}/impurities`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'updateLabels',
            frameId: currentFrame.frameId,
            userId: user.userId,
            corrections: corrections
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        
        // Update the frame in sessionFrames with new labeling status
        const updatedFrames = [...sessionFrames];
        updatedFrames[currentFrameIndex] = {
          ...updatedFrames[currentFrameIndex],
          labelingStatus: 'verified',
          labelingMetrics: data.labelingMetrics
        };
        setSessionFrames(updatedFrames);
        
        setIsEditingLabels(false);
        alert(t('labeling.saveSuccess'));
      } else {
        let errorMessage = 'Unknown error';
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || `HTTP ${response.status}`;
        } catch (e) {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        console.error('API Error:', response.status, errorMessage);
        alert(t('labeling.saveError') + ': ' + errorMessage);
      }
    } catch (err) {
      console.error('Error saving labels:', err);
      alert(t('labeling.saveError') + ': ' + (err.message || 'Network error'));
    } finally {
      setSavingLabels(false);
    }
  };
  
  const handleCancelEdit = () => {
    setIsEditingLabels(false);
  };

  const handleMarkAsDone = async () => {
    setSavingLabels(true);
    try {
      const authToken = getAuthToken();
      if (!authToken) {
        alert(t('labeling.saveError') + ': No authentication token');
        setSavingLabels(false);
        return;
      }

      const currentFrame = sessionFrames[currentFrameIndex];
      
      const response = await fetch(
        `${process.env.REACT_APP_API_BASE_URL}/impurities`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'markDone',
            frameId: currentFrame.frameId,
            userId: user.userId,
            detectionCount: currentFrame.detectionCount
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        const updatedFrames = [...sessionFrames];
        updatedFrames[currentFrameIndex] = {
          ...updatedFrames[currentFrameIndex],
          labelingStatus: 'verified',
          feedbackType: 'done',
          labelingMetrics: data.labelingMetrics
        };
        setSessionFrames(updatedFrames);
        alert(t('labeling.saveSuccess'));
      } else {
        const error = await response.json();
        alert(t('labeling.saveError') + ': ' + error.error);
      }
    } catch (err) {
      console.error('Error marking as done:', err);
      alert(t('labeling.saveError'));
    } finally {
      setSavingLabels(false);
    }
  };

  const handleWrongDetection = () => {
    setFeedbackData({
      frameId: sessionFrames[currentFrameIndex].frameId,
      type: 'wrongDetection',
      count: 0
    });
    setShowFeedbackForm(true);
  };

  const handleMissingObjects = () => {
    setFeedbackData({
      frameId: sessionFrames[currentFrameIndex].frameId,
      type: 'missingObjects',
      count: 0
    });
    setShowFeedbackForm(true);
  };

  const submitFeedback = async () => {
    if (feedbackData.count <= 0) {
      alert('Please enter a valid count');
      return;
    }

    setSavingLabels(true);
    try {
      const authToken = getAuthToken();
      if (!authToken) return;

      const response = await fetch(
        `${process.env.REACT_APP_API_BASE_URL}/impurities`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'submitFeedback',
            frameId: feedbackData.frameId,
            userId: user.userId,
            feedbackType: feedbackData.type,
            count: feedbackData.count
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        const updatedFrames = [...sessionFrames];
        updatedFrames[currentFrameIndex] = {
          ...updatedFrames[currentFrameIndex],
          labelingStatus: 'verified',
          feedbackType: feedbackData.type,
          feedbackCount: feedbackData.count,
          labelingMetrics: data.labelingMetrics
        };
        setSessionFrames(updatedFrames);
        setShowFeedbackForm(false);
        alert(t('labeling.saveSuccess'));
      } else {
        const error = await response.json();
        alert(t('labeling.saveError') + ': ' + error.error);
      }
    } catch (err) {
      console.error('Error submitting feedback:', err);
      alert(t('labeling.saveError'));
    } finally {
      setSavingLabels(false);
    }
  };

  const handleSignOut = async () => {
    if (onSignOut) {
      await onSignOut();
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: 'white', padding: '20px' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '30px',
        padding: '20px',
        backgroundColor: '#1e293b',
        borderRadius: '8px'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 'bold' }}>{t('history.title')}</h1>
          <p style={{ margin: '5px 0 0 0', color: '#94a3b8' }}>
            {t('history.tryAdjusting')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <LanguageSwitcher />
          <span style={{ color: '#94a3b8' }}>{t('dashboard.welcomeUser')}, {user?.username}</span>
          <button
            onClick={handleSignOut}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {t('nav.logout')}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div style={{ marginBottom: '20px' }}>
        <a 
          href="/"
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState({}, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          style={{ 
            color: '#3b82f6', 
            textDecoration: 'none',
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          ← {t('nav.dashboard')}
        </a>
      </div>

      {/* Statistics Summary */}
      {overallStats && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '20px',
          marginBottom: '30px'
        }}>
          <StatCard 
            title={t('dashboard.activeSessions')} 
            value={overallStats.totalSessions}
            subtitle="All time"
            color="#3b82f6"
          />
          <StatCard 
            title={t('dashboard.totalDetections')} 
            value={overallStats.totalDetections.toLocaleString()}
            subtitle="All time"
            color="#10b981"
          />
          <StatCard 
            title={t('dashboard.impuritiesFound')} 
            value={overallStats.totalImpurities.toLocaleString()}
            subtitle="All time"
            color="#f59e0b"
          />
          <StatCard 
            title={t('dashboard.detectionRate')} 
            value={`${overallStats.avgDetectionRate}%`}
            subtitle="Across all sessions"
            color="#8b5cf6"
          />
        </div>
      )}

      {/* Today's Stats */}
      {todayStats && todayStats.totalSessions > 0 && (
        <div style={{ 
          padding: '20px',
          backgroundColor: '#1e293b',
          borderRadius: '8px',
          marginBottom: '30px',
          borderLeft: '4px solid #10b981'
        }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#10b981' }}>{t('dashboard.statsToday')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('dashboard.activeSessions')}</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{todayStats.totalSessions}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('history.detections')}</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{todayStats.totalDetections}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('history.impurities')}</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{todayStats.totalImpurities}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('history.rate')}</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{todayStats.avgDetectionRate}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ 
        padding: '20px',
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        <h3 style={{ margin: '0 0 15px 0' }}>{t('history.filters')}</h3>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '15px'
        }}>
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: '#94a3b8' }}>
              {t('history.startDate')}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: 'white'
              }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: '#94a3b8' }}>
              {t('history.endDate')}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: 'white'
              }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: '#94a3b8' }}>
              {t('history.status')}
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: 'white'
              }}
            >
              <option value="">{t('history.allStatuses')}</option>
              <option value="active">{t('history.active')}</option>
              <option value="completed">{t('history.completed')}</option>
            </select>
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: '#94a3b8' }}>
              {t('history.sortBy')}
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: 'white'
              }}
            >
              <option value="startTime">{t('history.startTime')}</option>
              <option value="totalDetections">{t('history.totalDetections')}</option>
              <option value="detectionRate">{t('history.detectionRate')}</option>
            </select>
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', color: '#94a3b8' }}>
              {t('history.order')}
            </label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: 'white'
              }}
            >
              <option value="desc">{t('history.newest')}</option>
              <option value="asc">{t('history.oldest')}</option>
            </select>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={handleResetFilters}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#334155',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>

      {/* Sessions List */}
      <div style={{ 
        padding: '20px',
        backgroundColor: '#1e293b',
        borderRadius: '8px'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <h3 style={{ margin: 0 }}>
            Sessions ({pagination.totalSessions})
          </h3>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
            No sessions found. Start a detection session to see history.
          </div>
        ) : (
          <>
            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #334155' }}>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>
                      {t('session.time')}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>
                      {t('history.status')}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>
                      {t('history.duration')}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>
                      {t('history.frames')}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>
                      {t('history.detections')}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>
                      {t('history.impurities')}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>
                      {t('history.rate')}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center', color: '#94a3b8', fontWeight: '600' }}>
                      {t('common.view')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session, index) => (
                    <tr 
                      key={session.sessionId} 
                      style={{ 
                        borderBottom: '1px solid #334155',
                        backgroundColor: index % 2 === 0 ? 'transparent' : '#0f172a50'
                      }}
                    >
                      <td style={{ padding: '12px' }}>
                        <div style={{ fontSize: '14px' }}>{session.startTimeFormatted}</div>
                        {session.endTimeFormatted && (
                          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                            {t('dashboard.to')} {session.endTimeFormatted}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor: session.status === 'active' ? '#10b98120' : '#3b82f620',
                          color: session.status === 'active' ? '#10b981' : '#3b82f6'
                        }}>
                          {session.status === 'active' ? t('history.active') : t('history.completed')}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        {session.durationFormatted || '-'}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        {session.totalFrames}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 'bold', color: '#10b981' }}>
                        {session.totalDetections}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 'bold', color: '#f59e0b' }}>
                        {session.impuritiesFound}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        {session.detectionRate}%
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <button
                          onClick={() => handleViewDetails(session)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          {t('history.viewDetails')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                gap: '10px',
                marginTop: '20px'
              }}>
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={!pagination.hasPrev}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: pagination.hasPrev ? '#3b82f6' : '#334155',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: pagination.hasPrev ? 'pointer' : 'not-allowed'
                  }}
                >
                  {t('history.previous')}
                </button>
                
                <span style={{ color: '#94a3b8' }}>
                  {t('history.page')} {pagination.currentPage} {t('history.of')} {pagination.totalPages}
                </span>
                
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={!pagination.hasNext}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: pagination.hasNext ? '#3b82f6' : '#334155',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: pagination.hasNext ? 'pointer' : 'not-allowed'
                  }}
                >
                  {t('history.next')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Session Details Modal */}
      {showDetailsModal && selectedSession && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            padding: '30px',
            maxWidth: '900px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>{t('session.details')}</h2>
              <button
                onClick={() => setShowDetailsModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#334155',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {t('session.close')}
              </button>
            </div>

            <div style={{ display: 'grid', gap: '15px', marginBottom: '30px' }}>
              <DetailRow label={t('history.sessionId')} value={selectedSession.sessionId} />
              <DetailRow label={t('history.status')} value={selectedSession.status} />
              <DetailRow label={t('history.startTime')} value={selectedSession.startTimeFormatted} />
              {selectedSession.endTimeFormatted && (
                <DetailRow label={t('session.endTime')} value={selectedSession.endTimeFormatted} />
              )}
              {selectedSession.durationFormatted && (
                <DetailRow label={t('session.duration')} value={selectedSession.durationFormatted} />
              )}
              <DetailRow label={t('session.totalFrames')} value={selectedSession.totalFrames} />
              <DetailRow label={t('session.totalDetections')} value={selectedSession.totalDetections} />
              <DetailRow label={t('session.impuritiesFound')} value={selectedSession.impuritiesFound} />
              <DetailRow label={t('dashboard.detectionRate')} value={`${selectedSession.detectionRate}%`} />
              <DetailRow 
                label={t('session.avgDetections')} 
                value={selectedSession.avgDetectionsPerFrame} 
              />
            </div>

            {/* Frame Viewer */}
            <div style={{ 
              borderTop: '2px solid #334155',
              paddingTop: '20px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>{t('session.detectionFrames')}</h3>
                {sessionFrames.length > 0 && !isEditingLabels && (
                  <button
                    onClick={() => setIsEditingLabels(true)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                  >
                    ✏️ {t('labeling.editLabels')}
                  </button>
                )}
              </div>
              
              {loadingFrames ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  {t('session.loading')}
                </div>
              ) : sessionFrames.length > 0 ? (
                <>
                  {/* BboxAnnotator for editing mode */}
                  {isEditingLabels ? (
                    <BboxAnnotator 
                      imageUrl={sessionFrames[currentFrameIndex].s3UrlWithoutBbox}
                      detections={sessionFrames[currentFrameIndex].detections || []}
                      onSave={handleSaveLabels}
                      onCancel={handleCancelEdit}
                      saving={savingLabels}
                    />
                  ) : (
                    <>
                      {/* Frame Image */}
                      <div style={{
                        backgroundColor: '#0f172a',
                        borderRadius: '8px',
                        padding: '10px',
                        marginBottom: '15px',
                        textAlign: 'center'
                      }}>
                        <img 
                          src={sessionFrames[currentFrameIndex].s3UrlWithBbox}
                          alt={`Frame ${currentFrameIndex + 1}`}
                          style={{
                            maxWidth: '100%',
                            maxHeight: '400px',
                            borderRadius: '4px'
                          }}
                        />
                      </div>
                    </>
                  )}

                  {/* Frame Info */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr 1fr',
                    gap: '10px',
                    marginBottom: '15px',
                    padding: '12px',
                    backgroundColor: '#0f172a',
                    borderRadius: '4px'
                  }}>
                    <div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('session.frame')}</div>
                      <div style={{ fontWeight: 'bold' }}>{currentFrameIndex + 1} / {sessionFrames.length}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('history.detections')}</div>
                      <div style={{ fontWeight: 'bold', color: '#10b981' }}>{sessionFrames[currentFrameIndex].detectionCount}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('session.time')}</div>
                      <div style={{ fontSize: '12px' }}>{sessionFrames[currentFrameIndex].timestampFormatted}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t('labeling.status')}</div>
                      <div style={{ 
                        fontSize: '12px', 
                        fontWeight: 'bold',
                        color: sessionFrames[currentFrameIndex].labelingStatus === 'verified' ? '#10b981' : '#f59e0b'
                      }}>
                        {sessionFrames[currentFrameIndex].labelingStatus === 'verified' ? '✓ ' + t('labeling.verified') : t('labeling.autoLabeled')}
                      </div>
                    </div>
                  </div>

                  {/* Navigation Buttons */}
                  {!isEditingLabels && (
                    <>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '20px'
                      }}>
                        <button
                          onClick={handlePrevFrame}
                          disabled={currentFrameIndex === 0}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: currentFrameIndex === 0 ? '#334155' : '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: currentFrameIndex === 0 ? 'not-allowed' : 'pointer',
                            fontSize: '16px'
                          }}
                        >
                          ← {t('history.previous')}
                        </button>

                        <div style={{ color: '#94a3b8', fontSize: '14px' }}>
                          {t('session.useArrows')}
                        </div>

                        <button
                          onClick={handleNextFrame}
                          disabled={currentFrameIndex === sessionFrames.length - 1}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: currentFrameIndex === sessionFrames.length - 1 ? '#334155' : '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: currentFrameIndex === sessionFrames.length - 1 ? 'not-allowed' : 'pointer',
                            fontSize: '16px'
                          }}
                        >
                          {t('history.next')} →
                        </button>
                      </div>

                      {/* Feedback Buttons */}
                      {sessionFrames[currentFrameIndex].labelingStatus !== 'verified' && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                          gap: '10px',
                          padding: '15px',
                          backgroundColor: '#0f172a',
                          borderRadius: '4px',
                          border: '1px solid #334155'
                        }}>
                          <button
                            onClick={handleMarkAsDone}
                            disabled={savingLabels}
                            style={{
                              padding: '12px',
                              backgroundColor: '#10b981',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: savingLabels ? 'not-allowed' : 'pointer',
                              fontWeight: 'bold',
                              opacity: savingLabels ? 0.6 : 1
                            }}
                          >
                            ✓ Done
                          </button>

                          <button
                            onClick={handleMissingObjects}
                            disabled={savingLabels}
                            style={{
                              padding: '12px',
                              backgroundColor: '#f59e0b',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: savingLabels ? 'not-allowed' : 'pointer',
                              fontWeight: 'bold',
                              opacity: savingLabels ? 0.6 : 1
                            }}
                          >
                            ⚠ Missing Objects
                          </button>

                          <button
                            onClick={handleWrongDetection}
                            disabled={savingLabels}
                            style={{
                              padding: '12px',
                              backgroundColor: '#ef4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: savingLabels ? 'not-allowed' : 'pointer',
                              fontWeight: 'bold',
                              opacity: savingLabels ? 0.6 : 1
                            }}
                          >
                            ✗ Wrong Detection
                          </button>

                          <button
                            onClick={() => setIsEditingLabels(true)}
                            disabled={savingLabels}
                            style={{
                              padding: '12px',
                              backgroundColor: '#3b82f6',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: savingLabels ? 'not-allowed' : 'pointer',
                              fontWeight: 'bold',
                              opacity: savingLabels ? 0.6 : 1
                            }}
                          >
                            ✏ Edit Labels
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  {t('session.noFrames')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedbackForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1001
        }}>
          <div style={{
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            padding: '30px',
            maxWidth: '400px',
            width: '90%'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px' }}>
              {feedbackData.type === 'missingObjects' 
                ? 'Missing Objects Count' 
                : 'Wrong Detection Count'}
            </h3>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>
                {feedbackData.type === 'missingObjects' 
                  ? 'How many objects are missing?' 
                  : 'How many objects were incorrectly detected?'}
              </label>
              <input
                type="number"
                min="1"
                value={feedbackData.count}
                onChange={(e) => setFeedbackData({ ...feedbackData, count: parseInt(e.target.value) || 0 })}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowFeedbackForm(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#334155',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitFeedback}
                disabled={feedbackData.count <= 0 || savingLabels}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: feedbackData.count > 0 ? '#10b981' : '#334155',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: feedbackData.count > 0 ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold'
                }}
              >
                {savingLabels ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper Components
function StatCard({ title, value, subtitle, color }) {
  return (
    <div style={{
      padding: '20px',
      backgroundColor: '#1e293b',
      borderRadius: '8px',
      borderLeft: `4px solid ${color}`
    }}>
      <div style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '8px' }}>
        {title}
      </div>
      <div style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '4px' }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: '#94a3b8' }}>
        {subtitle}
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      padding: '12px',
      backgroundColor: '#0f172a',
      borderRadius: '4px'
    }}>
      <div style={{ color: '#94a3b8', fontSize: '14px' }}>{label}</div>
      <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{value}</div>
    </div>
  );
}
