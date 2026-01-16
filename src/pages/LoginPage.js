import React, { useState } from 'react';
import { signIn, confirmSignIn } from 'aws-amplify/auth';
import { useTranslation } from 'react-i18next';

export default function LoginPage({ onUserSignedIn }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [signInStep, setSignInStep] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn({ username, password });
      
      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setSignInStep('CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED');
        setPassword('');
        setLoading(false);
        return;
      }
      
      onUserSignedIn();
    } catch (err) {
      setError(err.message || t('login.signInFailed'));
      setLoading(false);
    }
  };

  const handleNewPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError(t('login.passwordsDoNotMatch'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('login.passwordMinLength'));
      return;
    }

    setLoading(true);
    try {
      await confirmSignIn({ challengeResponse: newPassword });
      onUserSignedIn();
    } catch (err) {
      setError(err.message || t('login.failedToChangePassword'));
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          padding: '40px 30px',
          textAlign: 'center'
        }}>
          {/* Header */}
          <div style={{ marginBottom: '30px' }}>
            <div style={{ fontSize: '48px', marginBottom: '15px' }}>🌾</div>
            <h1 style={{
              fontSize: '28px',
              fontWeight: 'bold',
              color: '#1f2937',
              marginBottom: '8px'
            }}>{t('login.title')}</h1>
            <p style={{
              color: '#6b7280',
              fontSize: '14px'
            }}>{t('login.subtitle')}</p>
          </div>

          {/* Error Alert */}
          {error && (
            <div style={{
              marginBottom: '20px',
              padding: '12px 16px',
              backgroundColor: '#fee2e2',
              borderLeft: '4px solid #ef4444',
              borderRadius: '6px',
              color: '#991b1b',
              fontSize: '14px',
              fontWeight: '600'
            }}>
              {error}
            </div>
          )}

          {/* Form */}
          {signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' ? (
            <form onSubmit={handleNewPassword} style={{ marginBottom: '20px' }}>
              <div style={{
                backgroundColor: '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '20px'
              }}>
                <p style={{
                  color: '#92400e',
                  fontSize: '14px',
                  fontWeight: '600'
                }}>
                  {t('login.pleaseSetNewPassword')}
                </p>
              </div>

              <div style={{ marginBottom: '16px', textAlign: 'left' }}>
                <label style={{
                  display: 'block',
                  color: '#374151',
                  fontWeight: '600',
                  marginBottom: '8px',
                  fontSize: '14px'
                }}>{t('login.newPassword')}</label>
                <input
                  type="password"
                  placeholder={t('login.minChars')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.3s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#667eea'}
                  onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                />
              </div>

              <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                <label style={{
                  display: 'block',
                  color: '#374151',
                  fontWeight: '600',
                  marginBottom: '8px',
                  fontSize: '14px'
                }}>{t('login.confirmPassword')}</label>
                <input
                  type="password"
                  placeholder={t('login.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.3s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#667eea'}
                  onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '11px 16px',
                  backgroundColor: loading ? '#9ca3af' : '#667eea',
                  color: 'white',
                  fontWeight: '600',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  transition: 'background-color 0.3s',
                  opacity: loading ? 0.6 : 1
                }}
              >
                {loading ? t('login.settingPassword') : t('login.setNewPassword')}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignIn} style={{ marginBottom: '20px' }}>
              <div style={{ marginBottom: '16px', textAlign: 'left' }}>
                <label style={{
                  display: 'block',
                  color: '#374151',
                  fontWeight: '600',
                  marginBottom: '8px',
                  fontSize: '14px'
                }}>{t('login.username')}</label>
                <input
                  type="text"
                  placeholder={t('login.enterUsername')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.3s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#667eea'}
                  onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                />
              </div>

              <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                <label style={{
                  display: 'block',
                  color: '#374151',
                  fontWeight: '600',
                  marginBottom: '8px',
                  fontSize: '14px'
                }}>{t('login.password')}</label>
                <input
                  type="password"
                  placeholder={t('login.enterPassword')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.3s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#667eea'}
                  onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '11px 16px',
                  backgroundColor: loading ? '#9ca3af' : '#667eea',
                  color: 'white',
                  fontWeight: '600',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  transition: 'background-color 0.3s',
                  opacity: loading ? 0.6 : 1
                }}
              >
                {loading ? t('login.signingIn') : t('login.signIn')}
              </button>

              <div style={{
                marginTop: '16px',
                fontSize: '13px',
                color: '#6b7280',
                textAlign: 'center'
              }}>
                <button 
                  type="button"
                  onClick={() => {}}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#667eea',
                    cursor: 'pointer',
                    textDecoration: 'none',
                    fontSize: '13px',
                    fontWeight: '600'
                  }}
                >
                  {t('login.forgotPassword')}
                </button>
              </div>
            </form>
          )}

          {/* Footer */}
          <div style={{
            marginTop: '20px',
            paddingTop: '20px',
            borderTop: '1px solid #e5e7eb',
            fontSize: '13px',
            color: '#6b7280'
          }}>
            <p>{t('login.needHelp')} 
              <button 
                type="button"
                onClick={() => {}}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#667eea',
                  cursor: 'pointer',
                  marginLeft: '4px',
                  fontWeight: '600'
                }}
              >
                {t('login.contactAdmin')}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
