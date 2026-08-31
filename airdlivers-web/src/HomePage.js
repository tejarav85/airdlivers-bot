import React, { useState, useEffect } from 'react';
import heroImage from './hero.png';
import { motion } from 'framer-motion';
import { 
    ClipboardEdit, UserCheck, MessageSquare, PackageCheck, ShieldCheck, Lock, FileWarning, 
    Star, CheckCircle2, Award, Globe, Users, TrendingUp 
} from 'lucide-react';
import './HomePage.css';

const Typewriter = ({ text, delay }) => {
    const [currentText, setCurrentText] = useState('');
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (currentIndex < text.length) {
            const timeout = setTimeout(() => {
                setCurrentText(prevText => prevText + text[currentIndex]);
                setCurrentIndex(prevIndex => prevIndex + 1);
            }, delay);
            return () => clearTimeout(timeout);
        }
    }, [currentIndex, delay, text]);

    return <span>{currentText}</span>;
};

export default function HomePage({ token, openLogin, navigateTo }) {
    const [stats, setStats] = useState({
        deliveriesCount: 1240,
        travelersCount: 450,
        usersCount: 1800,
        countriesCount: 38,
        rating: "4.9"
    });
    const [reviews, setReviews] = useState([]);
    const [loadingReviews, setLoadingReviews] = useState(true);

    useEffect(() => {
        // Fetch Live Stats
        fetch('/api/stats')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setStats(data);
                }
            })
            .catch(() => {});

        // Fetch Live Reviews
        fetch('/api/reviews')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.reviews) {
                    setReviews(data.reviews);
                }
            })
            .catch(() => {})
            .finally(() => setLoadingReviews(false));
    }, []);

    const handleServiceClick = (service) => {
        if (token) navigateTo(service);
        else openLogin();
    };

    return (
        <div className="home-container">
            {/* HERO SECTION */}
            <section className="hero" style={{ backgroundImage: `url(${heroImage})` }}>
                <div className="hero-content">
                    <motion.h1
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        Secure <span className="highlight">Next-Day</span> International Delivery
                    </motion.h1>

                    <motion.div
                        className="hero-subtext"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.5 }}
                    >
                        <Typewriter text="Connect • Communicate • Consign." delay={55} />
                    </motion.div>

                    <motion.div 
                        className="hero-buttons"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 1.2 }}
                    >
                        <button className="btn-primary" onClick={() => handleServiceClick('sender')}>
                            📦 Send Shipment
                        </button>
                        <button className="btn-secondary" onClick={() => handleServiceClick('traveler')}>
                            🧳 Travel with Shipment
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

            {/* UNIFIED PROOF & REVIEWS SECTION: WHAT OUR CUSTOMERS SAY */}
            <section className="section reviews-section" id="reviews">
                <div className="section-header-centered">
                    <h2>What Our Customers Say</h2>
                    <p className="section-subtitle">Real experiences and proven track record from verified senders and travelers globally.</p>
                </div>

                {/* COMPACT TRUST METRICS STATS RIBBON */}
                <div className="embedded-stats-grid">
                    <div className="stat-card">
                        <div className="stat-icon-wrapper"><TrendingUp size={24} className="stat-icon" /></div>
                        <div className="stat-info">
                            <h3>{stats.deliveriesCount.toLocaleString()}+</h3>
                            <p>Successful Deliveries</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon-wrapper"><Users size={24} className="stat-icon" /></div>
                        <div className="stat-info">
                            <h3>{stats.travelersCount.toLocaleString()}+</h3>
                            <p>Verified Travelers</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon-wrapper"><Globe size={24} className="stat-icon" /></div>
                        <div className="stat-info">
                            <h3>{stats.countriesCount}+</h3>
                            <p>Global Routes</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon-wrapper"><Award size={24} className="stat-icon" /></div>
                        <div className="stat-info">
                            <h3>{stats.rating} / 5.0 ⭐</h3>
                            <p>Customer Satisfaction</p>
                        </div>
                    </div>
                </div>

                {/* VERIFIED CUSTOMER REVIEWS GRID */}
                {loadingReviews ? (
                    <div className="reviews-loading">Loading verified customer reviews...</div>
                ) : (
                    <div className="reviews-grid">
                        {reviews.map((rev, idx) => (
                            <div className="review-card" key={rev._id || idx}>
                                <div className="review-header">
                                    <div className="reviewer-avatar">
                                        {rev.userName ? rev.userName.charAt(0).toUpperCase() : 'U'}
                                    </div>
                                    <div className="reviewer-meta">
                                        <div className="reviewer-name-row">
                                            <span className="reviewer-name">{rev.userName}</span>
                                            {rev.verified && (
                                                <span className="verified-badge">
                                                    <CheckCircle2 size={14} color="#10b981" /> Verified
                                                </span>
                                            )}
                                        </div>
                                        <div className="reviewer-sub-info">
                                            <span className="role-tag">{rev.role || 'Member'}</span>
                                            <span className="route-tag">{rev.route}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="stars-row">
                                    {[...Array(5)].map((_, i) => (
                                        <Star 
                                            key={i} 
                                            size={16} 
                                            fill={i < (rev.rating || 5) ? "#f59e0b" : "none"} 
                                            color={i < (rev.rating || 5) ? "#f59e0b" : "#4b5563"} 
                                        />
                                    ))}
                                </div>
                                <p className="review-comment">"{rev.comment}"</p>
                            </div>
                        ))}
                    </div>
                )}
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
                    <p>© {new Date().getFullYear()} AirDlivers Private Limited. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
}
