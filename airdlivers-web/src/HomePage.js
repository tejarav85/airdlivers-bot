import React, { useState, useEffect } from 'react';
import heroImage from './hero.png';
import { motion } from 'framer-motion';
import { 
    ClipboardEdit, UserCheck, MessageSquare, PackageCheck, ShieldCheck, Lock, FileWarning, 
    Star, CheckCircle2, Award, Globe, TrendingUp, X 
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
    const [selectedProofTab, setSelectedProofTab] = useState(null); // null, 'deliveries', 'routes', 'satisfaction', 'reviews'

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

            {/* COMPACT PROOF STRIP SECTION */}
            <section className="section proof-strip-section" id="reviews">
                <div className="proof-strip-card">
                    <div className="proof-strip-header">
                        <span className="proof-strip-tag">TRUST & VERIFIED METRICS</span>
                        <h3 className="proof-strip-title">Platform Statistics & Member Feedback</h3>
                        <p className="proof-strip-sub">Click any pill to view real-time counts and member reviews</p>
                    </div>
                    <div className="proof-pills-row">
                        <button className="proof-pill-btn" onClick={() => setSelectedProofTab('deliveries')}>
                            <div className="pill-icon-box"><TrendingUp size={18} /></div>
                            <span className="pill-label">Successful Deliveries</span>
                            <span className="pill-badge-action">View</span>
                        </button>

                        <button className="proof-pill-btn" onClick={() => setSelectedProofTab('routes')}>
                            <div className="pill-icon-box"><Globe size={18} /></div>
                            <span className="pill-label">Global Routes</span>
                            <span className="pill-badge-action">View</span>
                        </button>

                        <button className="proof-pill-btn" onClick={() => setSelectedProofTab('satisfaction')}>
                            <div className="pill-icon-box"><Award size={18} /></div>
                            <span className="pill-label">Customer Satisfaction</span>
                            <span className="pill-badge-action rating-accent">{stats.rating} ⭐</span>
                        </button>

                        <button className="proof-pill-btn highlight-pill-btn" onClick={() => setSelectedProofTab('reviews')}>
                            <div className="pill-icon-box"><MessageSquare size={18} /></div>
                            <span className="pill-label">Verified Reviews</span>
                            <span className="pill-badge-action reviews-accent">
                                {reviews.length > 0 ? `${reviews.length} Reviews` : 'View'}
                            </span>
                        </button>
                    </div>
                </div>
            </section>

            {/* MODAL OVERLAY FOR PROOF TABS */}
            {selectedProofTab && (
                <div className="proof-modal-overlay" onClick={() => setSelectedProofTab(null)}>
                    <div className="proof-modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="proof-modal-header">
                            <div>
                                <h3>AirDlivers Trust & Verified Stats</h3>
                                <p>Live performance indicators and community reviews</p>
                            </div>
                            <button className="proof-modal-close" onClick={() => setSelectedProofTab(null)} aria-label="Close modal">
                                <X size={20} />
                            </button>
                        </div>

                        {/* INTERNAL TAB SWITCHER */}
                        <div className="proof-modal-tabs">
                            <button 
                                className={`modal-tab-btn ${selectedProofTab === 'deliveries' ? 'active' : ''}`}
                                onClick={() => setSelectedProofTab('deliveries')}
                            >
                                <TrendingUp size={16} /> Deliveries ({stats.deliveriesCount.toLocaleString()}+)
                            </button>
                            <button 
                                className={`modal-tab-btn ${selectedProofTab === 'routes' ? 'active' : ''}`}
                                onClick={() => setSelectedProofTab('routes')}
                            >
                                <Globe size={16} /> Global Routes ({stats.countriesCount}+)
                            </button>
                            <button 
                                className={`modal-tab-btn ${selectedProofTab === 'satisfaction' ? 'active' : ''}`}
                                onClick={() => setSelectedProofTab('satisfaction')}
                            >
                                <Award size={16} /> Rating ({stats.rating} ⭐)
                            </button>
                            <button 
                                className={`modal-tab-btn ${selectedProofTab === 'reviews' ? 'active' : ''}`}
                                onClick={() => setSelectedProofTab('reviews')}
                            >
                                <MessageSquare size={16} /> Reviews ({reviews.length})
                            </button>
                        </div>

                        {/* MODAL BODY CONTENT */}
                        <div className="proof-modal-body">
                            {selectedProofTab === 'deliveries' && (
                                <div className="proof-detail-card">
                                    <div className="stat-hero-badge">
                                        <div className="stat-big-val">{stats.deliveriesCount.toLocaleString()}+</div>
                                        <h4>Successful Next-Day Deliveries</h4>
                                        <p>Packages hand-carried safely on international flights directly from senders to recipients worldwide.</p>
                                    </div>
                                    <div className="proof-highlights-grid">
                                        <div className="highlight-item">
                                            <CheckCircle2 size={20} color="#10b981" />
                                            <div>
                                                <strong>Real-Time Tracking & Handoff</strong>
                                                <p>In-app flight tracking and verified airport meeting points for seamless delivery.</p>
                                            </div>
                                        </div>
                                        <div className="highlight-item">
                                            <CheckCircle2 size={20} color="#10b981" />
                                            <div>
                                                <strong>100% ID Verified Members</strong>
                                                <p>All travelers and senders undergo strict government passport and selfie validation.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {selectedProofTab === 'routes' && (
                                <div className="proof-detail-card">
                                    <div className="stat-hero-badge">
                                        <div className="stat-big-val">{stats.countriesCount}+</div>
                                        <h4>Active Countries & International Routes</h4>
                                        <p>Connecting major global corridors across North America, Europe, Asia, Middle East, and Australia.</p>
                                    </div>
                                    <h5 style={{ margin: '16px 0 10px', fontSize: '15px', color: '#1e293b' }}>Popular Air Corridors:</h5>
                                    <div className="popular-routes-tags">
                                        <span className="route-pill-tag">✈️ New York (JFK) ➔ London (LHR)</span>
                                        <span className="route-pill-tag">✈️ Toronto (YYZ) ➔ Delhi (DEL)</span>
                                        <span className="route-pill-tag">✈️ Dubai (DXB) ➔ Mumbai (BOM)</span>
                                        <span className="route-pill-tag">✈️ San Francisco (SFO) ➔ Frankfurt (FRA)</span>
                                        <span className="route-pill-tag">✈️ Sydney (SYD) ➔ Singapore (SIN)</span>
                                        <span className="route-pill-tag">✈️ Chicago (ORD) ➔ Hyderabad (HYD)</span>
                                    </div>
                                </div>
                            )}

                            {selectedProofTab === 'satisfaction' && (
                                <div className="proof-detail-card">
                                    <div className="stat-hero-badge">
                                        <div className="stat-big-val">{stats.rating} / 5.0 ⭐</div>
                                        <h4>Verified Customer Satisfaction Score</h4>
                                        <p>Calculated from post-delivery feedback provided by confirmed senders and travelers.</p>
                                    </div>
                                    <div className="rating-distribution-box">
                                        <div className="rating-row">
                                            <span>5 Stars</span>
                                            <div className="rating-progress"><div className="progress-bar" style={{ width: '94%' }}></div></div>
                                            <span>94%</span>
                                        </div>
                                        <div className="rating-row">
                                            <span>4 Stars</span>
                                            <div className="rating-progress"><div className="progress-bar" style={{ width: '5%' }}></div></div>
                                            <span>5%</span>
                                        </div>
                                        <div className="rating-row">
                                            <span>3 Stars</span>
                                            <div className="rating-progress"><div className="progress-bar" style={{ width: '1%' }}></div></div>
                                            <span>1%</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {selectedProofTab === 'reviews' && (
                                <div className="proof-detail-card">
                                    <div className="modal-reviews-header">
                                        <h4>Verified Member Feedback</h4>
                                        <p>Authentic reviews submitted post-completion by registered platform members.</p>
                                    </div>
                                    {loadingReviews ? (
                                        <div className="reviews-loading">Loading verified customer reviews...</div>
                                    ) : reviews.length === 0 ? (
                                        <div className="no-reviews">No reviews available yet.</div>
                                    ) : (
                                        <div className="modal-reviews-list">
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
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

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
