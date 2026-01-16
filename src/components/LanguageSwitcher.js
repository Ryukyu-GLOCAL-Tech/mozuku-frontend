import React from 'react';
import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng); // Persist language selection
  };

  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      alignItems: 'center'
    }}>
      <button
        onClick={() => changeLanguage('en')}
        style={{
          padding: '6px 12px',
          borderRadius: '4px',
          border: i18n.language === 'en' ? '2px solid #3b82f6' : '1px solid #d1d5db',
          backgroundColor: i18n.language === 'en' ? '#eff6ff' : 'white',
          color: i18n.language === 'en' ? '#1e40af' : '#6b7280',
          fontSize: '14px',
          fontWeight: i18n.language === 'en' ? '600' : '400',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        EN
      </button>
      <button
        onClick={() => changeLanguage('ja')}
        style={{
          padding: '6px 12px',
          borderRadius: '4px',
          border: i18n.language === 'ja' ? '2px solid #3b82f6' : '1px solid #d1d5db',
          backgroundColor: i18n.language === 'ja' ? '#eff6ff' : 'white',
          color: i18n.language === 'ja' ? '#1e40af' : '#6b7280',
          fontSize: '14px',
          fontWeight: i18n.language === 'ja' ? '600' : '400',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        日本語
      </button>
    </div>
  );
};

export default LanguageSwitcher;
