import React, { useState, useRef, useEffect } from 'react';
import { Menu, X, Package, PlaneTakeoff, Info, Home, User, LogOut, ChevronDown, MessageCircleHeart, Bell } from 'lucide-react';
import './Navbar.css';

export default function Navbar({ token, openService, logout, openLogin, navigateTo, unreadSupport, unreadService, openSupportTab, openServiceTab }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const dropdownRef = useRef(null);
  const notifRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef, notifRef]);

  const handleServiceClick = (service) => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    if (token) {
      openService(service);
    } else {
      openLogin();
    }
  };

  const handleNavClick = (page) => {
    setMobileMenuOpen(false);
    if (page === 'about' || page === 'support') {
      const element = document.getElementById(page);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      } else {
        navigateTo('home');
        setTimeout(() => {
          const el = document.getElementById(page);
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    } else {
      navigateTo(page);
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">

        {/* Left Side */}
        <div className="navbar-left">
          <div className="navbar-logo" onClick={() => handleNavClick('home')} style={{ cursor: 'pointer' }}>
            <span style={{ color: '#007bff' }}>Air</span>
            <span style={{ color: '#000000' }}>Dlivers</span>
          </div>

          <div className={`navbar-links desktop-only`}>
            <span onClick={() => handleNavClick('home')} className="nav-item">Home</span>
            <span onClick={() => handleNavClick('about')} className="nav-item">About Us</span>

            <div
              className="nav-item dropdown"
              ref={dropdownRef}
              onMouseEnter={() => setDropdownOpen(true)}
              onMouseLeave={() => setDropdownOpen(false)}
            >
              <span className="dropdown-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>Services <ChevronDown size={16} /></span>
              {dropdownOpen && (
                <div className="dropdown-menu">
                  <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); handleServiceClick('sender'); }}>
                    <Package size={16} style={{ marginRight: '8px' }} /> Send Shipment
                  </div>
                  <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); handleServiceClick('traveler'); }}>
                    <PlaneTakeoff size={16} style={{ marginRight: '8px' }} /> Travel With Shipment
                  </div>
                </div>
              )}
            </div>

            <span onClick={() => handleServiceClick('my_services')} className="nav-item">My Services</span>
          </div>
        </div>

        {/* Hamburger */}
        <div className="mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </div>

        {/* Right Side */}
        <div className={`navbar-right desktop-only`}>
          {token && (
            <div className="notification-bell" ref={notifRef} onClick={() => setNotifOpen(!notifOpen)}>
               <Bell size={20} />
               {(unreadSupport || unreadService) && <span className="notification-badge" />}
               
               {notifOpen && (
                 <div className="notification-dropdown">
                    {unreadSupport && (
                      <div className="notification-item" onClick={(e) => { e.stopPropagation(); setNotifOpen(false); openSupportTab(); }}>
                        <MessageCircleHeart size={16} color="#e74c3c" /> New support message
                      </div>
                    )}
                    {unreadService && (
                      <div className="notification-item" onClick={(e) => { e.stopPropagation(); setNotifOpen(false); openServiceTab(); }}>
                        <Package size={16} color="#007bff" /> New service update
                      </div>
                    )}
                    {!unreadSupport && !unreadService && (
                      <div className="notification-item" style={{ color: '#999', cursor: 'default' }}>
                        No new notifications
                      </div>
                    )}
                 </div>
               )}
            </div>
          )}
          <span onClick={() => handleNavClick('support')} className="nav-item support-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MessageCircleHeart size={18} /> Support</span>
          {token ? (
            <button className="auth-btn logout-btn" onClick={() => { setMobileMenuOpen(false); logout(); }}><LogOut size={16} style={{ marginRight: '6px' }} /> Logout</button>
          ) : (
            <button className="auth-btn login-btn" onClick={() => { setMobileMenuOpen(false); openLogin(); }}><User size={16} style={{ marginRight: '6px' }} /> Login</button>
          )}
        </div>

        {/* Mobile menu panel */}
        {mobileMenuOpen && (
          <div className="mobile-menu-overlay">
            <div className="mobile-menu-panel">
              <span onClick={() => handleNavClick('home')} className="mobile-nav-item"><Home size={20} /> Home</span>
              <span onClick={() => handleNavClick('about')} className="mobile-nav-item"><Info size={20} /> About Us</span>

              <div className="mobile-nav-item-group">
                <span className="mobile-group-title">Services</span>
                <span onClick={() => handleServiceClick('sender')} className="mobile-sub-item"><Package size={18} /> Send Shipment</span>
                <span onClick={() => handleServiceClick('traveler')} className="mobile-sub-item"><PlaneTakeoff size={18} /> Travel With Shipment</span>
                <span onClick={() => handleServiceClick('my_services')} className="mobile-sub-item"><Package size={18} /> My Services</span>
              </div>

              <span onClick={() => handleNavClick('support')} className="mobile-nav-item"><MessageCircleHeart size={20} /> Support</span>

              <div className="mobile-menu-footer">
                {token ? (
                  <button className="auth-btn logout-btn w-full justify-center" onClick={() => { setMobileMenuOpen(false); logout(); }}><LogOut size={18} style={{ marginRight: '8px' }} /> Logout</button>
                ) : (
                  <button className="auth-btn login-btn w-full justify-center" onClick={() => { setMobileMenuOpen(false); openLogin(); }}><User size={18} style={{ marginRight: '8px' }} /> Login</button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </nav>
  );
}