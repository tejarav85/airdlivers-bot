import React from 'react';
import { motion } from 'framer-motion';
import { ClipboardEdit, UserCheck, MessageSquare, PackageCheck, ShieldCheck, Lock, FileWarning } from 'lucide-react';
import './HomePage.css';

export default function HomePage({ token, openLogin, navigateTo }) {
    const handleServiceClick = (service) => {
        if (token) navigateTo(service);
        else openLogin();
    };

    return (
        <div className="home-container">
            {/* HERO SECTION */}
            <section className="hero">
                <div className="hero-content">
                    <motion.h1
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                    >
                        Fast, Secure International Delivery via Trusted Travelers
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                    >
                        Connect with airline passengers willing to carry your packages next-day, or travel and offset your ticket costs.
                    </motion.p>
                    
                    <motion.div 
                        className="hero-image-container"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.8, delay: 0.4 }}
                        style={{ width: '100%', maxWidth: '800px', margin: '20px auto 40px auto' }}
                    >
                        <img 
                            src="/hero.png" 
                            alt="AirDlivers Smart Delivery" 
                            style={{ width: '100%', height: 'auto', borderRadius: '12px' }}
                            onError={(e) => {
                                // Fallback just in case they haven't put the image there yet
                                e.target.style.display = 'none';
                            }}
                        />
                    </motion.div>

                    <motion.div 
                        className="hero-buttons"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.6 }}
                    >
                        <button className="btn-primary" onClick={() => handleServiceClick('sender')}>
                            📦 Send Shipment
                        </button>
                        <button className="btn-secondary" onClick={() => handleServiceClick('traveler')}>
                            🧳 Travel With Shipment
                        </button>
                    </motion.div>
                </div>
            </section>

            {/* ABOUT AIRDLIVERS */}
            <section className="section about" id="about">
                <h2>About AirDlivers</h2>
                <div className="about-grid">
                    <div className="about-text">
                        <p>AirDlivers is a global peer-to-peer delivery network. We bridge the gap between people who need urgent, next-day international shipping and frequent flyers looking to subsidize their travel expenses.</p>
                        <p>Our platform handles matching, identity verification, and secure communication without exposing personal data until it's absolutely necessary. We connect individuals safely across the globe.</p>
                    </div>
                    <div className="about-image">
                        <img src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&q=80&w=800" alt="Airplane" />
                    </div>
                </div>
            </section>

            {/* HOW IT WORKS */}
            <section className="section how-it-works">
                <h2>How It Works</h2>
                <div className="steps-container">
                    <div className="step-card">
                        <div className="step-icon" style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', color: '#007bff' }}>
                            <ClipboardEdit size={48} strokeWidth={1.5} />
                        </div>
                        <h3>1. Submit Request</h3>
                        <p>Senders post package details. Travelers post flight details. Personal info remains completely hidden.</p>
                    </div>
                    <div className="step-card">
                        <div className="step-icon" style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', color: '#007bff' }}>
                            <UserCheck size={48} strokeWidth={1.5} />
                        </div>
                        <h3>2. Match & Approve</h3>
                        <p>Admin verifies ID. The system securely matches optimal routes. You both review and confirm the match.</p>
                    </div>
                    <div className="step-card">
                        <div className="step-icon" style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', color: '#007bff' }}>
                            <MessageSquare size={48} strokeWidth={1.5} />
                        </div>
                        <h3>3. Chat & Meet</h3>
                        <p>Meet at the airport or agreed location. Safe, tracked in-app messaging enables tight coordination.</p>
                    </div>
                    <div className="step-card">
                        <div className="step-icon" style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', color: '#007bff' }}>
                            <PackageCheck size={48} strokeWidth={1.5} />
                        </div>
                        <h3>4. Delivered</h3>
                        <p>Package arrives safely. Both parties mark delivery as complete, and the contract is finalized securely.</p>
                    </div>
                </div>
            </section>

            {/* SAFETY / PRIVACY / TERMS */}
            <section className="section safety">
                <h2>Safety, Privacy & Terms</h2>
                <div className="safety-grid">
                    <div className="safety-card">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><ShieldCheck size={24} color="#007bff" /> Identity Verification</h3>
                        <p>All users must upload government-issued IDs, Passports, Visas, and Live Selfies before being allowed into the network.</p>
                    </div>
                    <div className="safety-card">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Lock size={24} color="#007bff" /> Privacy First</h3>
                        <p>Only your route, date, and package weight are visible until match confirmation. Chat histories are securely encrypted.</p>
                    </div>
                    <div className="safety-card">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><FileWarning size={24} color="#007bff" /> Strict Policies</h3>
                        <p>Illegal items are strictly prohibited. We do not handle payments. Any policy violations result in immediate permanent bans.</p>
                    </div>
                </div>
            </section>

            {/* SUPPORT / CONTACT */}
            <section className="section contact" id="support">
                <h2>Need Support?</h2>
                <p>If you encounter any issues, our active support team is available 24/7 to assist with verifications, matching, or disputes.</p>
                <div className="contact-links">
                    <button onClick={() => navigateTo('support')} className="btn-outline">📞 Chat with Us</button>
                    <a href="mailto:info@airdlivers.com" className="btn-outline">📧 info@airdlivers.com</a>
                </div>
            </section>

            {/* FOOTER */}
            <footer className="footer">
                <div className="footer-content">
                    <h3 onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ cursor: 'pointer' }}>
                        <span style={{ color: '#007bff' }}>Air</span>
                        <span style={{ color: '#ffffff' }}>Dlivers</span>
                    </h3>
                    <p>© {new Date().getFullYear()} AirDlivers. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
}
