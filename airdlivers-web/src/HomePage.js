import React, { useState, useEffect } from 'react';
import heroImage from './hero.png';
import { motion } from 'framer-motion';
import { 
    ClipboardEdit, UserCheck, MessageSquare, PackageCheck, ShieldCheck, Lock, FileWarning, 
    Star, CheckCircle2, Award, Globe, TrendingUp, PenTool 
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
    const [activeTab, setActiveTab] = useState('deliveries'); // 'deliveries', 'routes', 'satisfaction', 'reviews'

    // Write Review state
    const [showWriteReview, setShowWriteReview] = useState(false);
    const [newRating, setNewRating] = useState(5);
    const [newComment, setNewComment] = useState('');
    const [newRoute, setNewRoute] = useState('');
    const [newRole, setNewRole] = useState('Sender');
    const [submittingReview, setSubmittingReview] = useState(false);
    const [reviewSuccess, setReviewSuccess] = useState('');
    const [reviewError, setReviewError] = useState('');

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

    const handleReviewSubmit = async (e) => {
        e.preventDefault();
        if (!token) {
            openLogin();
            return;
        }
        if (!newComment.trim()) return;

        setSubmittingReview(true);
        setReviewError('');
        setReviewSuccess('');

        try {
            const res = await fetch('/api/reviews/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    rating: newRating,
                    comment: newComment,
                    route: newRoute || 'Global Route',
                    role: newRole
                })
            });

            const data = await res.json();
            if (data.success) {
                setReviewSuccess('Thank you! Your review has been submitted successfully.');
                setNewComment('');
                setNewRoute('');
                setShowWriteReview(false);
                // Refresh reviews & stats
                fetch('/api/reviews')
                    .then(r => r.json())
                    .then(d => { if (d.success && d.reviews) setReviews(d.reviews); });
                fetch('/api/stats')
                    .then(r => r.json())
                    .then(d => { if (d.success) setStats(d); });
            } else {
                setReviewError(data.error || 'Failed to submit review');
            }
        } catch (err) {
            setReviewError('Error submitting review. Please try again.');
        } finally {
            setSubmittingReview(false);
        }
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

            {/* WHAT OUR CUSTOMERS SAY - RESPONSIVE STRIP (NO INITIAL NUMBERS) */}
            <section className="section reviews-section" id="reviews">
                <div className="section-header-centered">
                    <h2>What Our Customers Say</h2>
                    <p className="section-subtitle">Real experiences and proven track record from verified senders and travelers globally.</p>
                </div>

                {/* CLEAN RESPONSIVE STRIP */}
                <div className="proof-strip-bar">
                    <button 
                        className={`strip-tab-btn ${activeTab === 'deliveries' ? 'active' : ''}`}
                        onClick={() => setActiveTab(activeTab === 'deliveries' ? null : 'deliveries')}
                    >
                        <TrendingUp size={20} className="tab-icon" />
                        <span>Successful Deliveries</span>
                    </button>

                    <button 
                        className={`strip-tab-btn ${activeTab === 'routes' ? 'active' : ''}`}
                        onClick={() => setActiveTab(activeTab === 'routes' ? null : 'routes')}
                    >
                        <Globe size={20} className="tab-icon" />
                        <span>Global Routes</span>
                    </button>

                    <button 
                        className={`strip-tab-btn ${activeTab === 'satisfaction' ? 'active' : ''}`}
                        onClick={() => setActiveTab(activeTab === 'satisfaction' ? null : 'satisfaction')}
                    >
                        <Award size={20} className="tab-icon" />
                        <span>Customer Satisfaction</span>
                    </button>

                    <button 
                        className={`strip-tab-btn ${activeTab === 'reviews' ? 'active' : ''}`}
                        onClick={() => setActiveTab(activeTab === 'reviews' ? null : 'reviews')}
                    >
                        <MessageSquare size={20} className="tab-icon" />
                        <span>Customer Reviews</span>
                    </button>
                </div>

                {/* INLINE EXPANDABLE RESPONSIVE PANEL (NO POPUPS) */}
                {activeTab && (
                    <div className="strip-tab-panel">
                        {activeTab === 'deliveries' && (
                            <div className="panel-content-card">
                                <div className="panel-stat-header">
                                    <div className="panel-big-number">
                                        {stats.deliveriesCount > 0 ? `${stats.deliveriesCount.toLocaleString()}+` : "0"}
                                    </div>
                                    <div className="panel-stat-details">
                                        <h3>Successful Next-Day Deliveries</h3>
                                        <p>Packages hand-carried safely by verified international travelers directly from sender to recipient.</p>
                                    </div>
                                </div>
                                <div className="panel-highlights-row">
                                    <div className="panel-highlight-box">
                                        <CheckCircle2 size={20} color="#10b981" />
                                        <span>100% On-Time Peer-to-Peer Handoff</span>
                                    </div>
                                    <div className="panel-highlight-box">
                                        <CheckCircle2 size={20} color="#10b981" />
                                        <span>Verified Passport & Flight Documentation</span>
                                    </div>
                                    <div className="panel-highlight-box">
                                        <CheckCircle2 size={20} color="#10b981" />
                                        <span>Encrypted Direct In-App Chat</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'routes' && (
                            <div className="panel-content-card">
                                <div className="panel-stat-header">
                                    <div className="panel-big-number">
                                        {stats.countriesCount > 0 ? `${stats.countriesCount}+` : "0"}
                                    </div>
                                    <div className="panel-stat-details">
                                        <h3>Global Active Flight Routes & Corridors</h3>
                                        <p>Connecting senders and frequent travelers across international flight hubs worldwide.</p>
                                    </div>
                                </div>
                                <div className="panel-routes-tags">
                                    <span className="route-tag-chip">✈️ New York (JFK) ➔ London (LHR)</span>
                                    <span className="route-tag-chip">✈️ Toronto (YYZ) ➔ Delhi (DEL)</span>
                                    <span className="route-tag-chip">✈️ Dubai (DXB) ➔ Mumbai (BOM)</span>
                                    <span className="route-tag-chip">✈️ San Francisco (SFO) ➔ Frankfurt (FRA)</span>
                                    <span className="route-tag-chip">✈️ Sydney (SYD) ➔ Singapore (SIN)</span>
                                    <span className="route-tag-chip">✈️ Chicago (ORD) ➔ Hyderabad (HYD)</span>
                                </div>
                            </div>
                        )}

                        {activeTab === 'satisfaction' && (
                            <div className="panel-content-card">
                                <div className="panel-stat-header">
                                    <div className="panel-big-number">
                                        {stats.rating !== "0.0" ? `${stats.rating} / 5.0 ⭐` : "0.0 ⭐"}
                                    </div>
                                    <div className="panel-stat-details">
                                        <h3>Customer Satisfaction Rating</h3>
                                        <p>Calculated average from post-delivery feedback left by confirmed senders and travelers.</p>
                                    </div>
                                </div>
                                {stats.rating !== "0.0" ? (
                                    <div className="panel-rating-bars">
                                        <div className="panel-bar-row">
                                            <span>5 Stars ⭐⭐⭐⭐⭐</span>
                                            <div className="bar-track"><div className="bar-fill" style={{ width: '94%' }}></div></div>
                                            <span>94%</span>
                                        </div>
                                        <div className="panel-bar-row">
                                            <span>4 Stars ⭐⭐⭐⭐</span>
                                            <div className="bar-track"><div className="bar-fill" style={{ width: '5%' }}></div></div>
                                            <span>5%</span>
                                        </div>
                                        <div className="panel-bar-row">
                                            <span>3 Stars ⭐⭐⭐</span>
                                            <div className="bar-track"><div className="bar-fill" style={{ width: '1%' }}></div></div>
                                            <span>1%</span>
                                        </div>
                                    </div>
                                ) : (
                                    <p style={{ color: '#64748b', fontStyle: 'italic' }}>No completed delivery reviews yet.</p>
                                )}
                            </div>
                        )}

                        {activeTab === 'reviews' && (
                            <div className="panel-content-card">
                                <div className="panel-reviews-header">
                                    <div>
                                        <h3>Verified Member Reviews</h3>
                                        <p>Authentic feedback from registered AirDlivers community members.</p>
                                    </div>
                                    <button 
                                        className="btn-write-review-trigger"
                                        onClick={() => {
                                            if (!token) {
                                                openLogin();
                                            } else {
                                                setShowWriteReview(!showWriteReview);
                                            }
                                        }}
                                    >
                                        <PenTool size={16} /> {showWriteReview ? "Cancel Review" : "✍️ Write a Review"}
                                    </button>
                                </div>

                                {/* INLINE WRITE A REVIEW FORM */}
                                {showWriteReview && (
                                    <div className="inline-write-review-form">
                                        <h4>Write Your Verified Review</h4>
                                        {reviewSuccess && <div className="review-alert-success">{reviewSuccess}</div>}
                                        {reviewError && <div className="review-alert-error">{reviewError}</div>}
                                        
                                        <form onSubmit={handleReviewSubmit}>
                                            <div className="form-row-2col">
                                                <div className="form-group">
                                                    <label>Your Role</label>
                                                    <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                                                        <option value="Sender">Sender</option>
                                                        <option value="Traveler">Traveler</option>
                                                    </select>
                                                </div>
                                                <div className="form-group">
                                                    <label>Flight Route (e.g. Delhi ✈️ Toronto)</label>
                                                    <input 
                                                        type="text" 
                                                        placeholder="e.g., New York ✈️ London" 
                                                        value={newRoute} 
                                                        onChange={(e) => setNewRoute(e.target.value)}
                                                        required 
                                                    />
                                                </div>
                                            </div>

                                            <div className="form-group">
                                                <label>Rating</label>
                                                <div className="star-picker">
                                                    {[1, 2, 3, 4, 5].map((starVal) => (
                                                        <Star 
                                                            key={starVal} 
                                                            size={24} 
                                                            className="star-clickable"
                                                            fill={starVal <= newRating ? "#f59e0b" : "none"} 
                                                            color={starVal <= newRating ? "#f59e0b" : "#94a3b8"} 
                                                            onClick={() => setNewRating(starVal)}
                                                            style={{ cursor: 'pointer', marginRight: '6px' }}
                                                        />
                                                    ))}
                                                    <span className="rating-label">{newRating}.0 Stars</span>
                                                </div>
                                            </div>

                                            <div className="form-group">
                                                <label>Your Experience / Comment</label>
                                                <textarea 
                                                    rows={3} 
                                                    placeholder="Share your experience with AirDlivers..." 
                                                    value={newComment} 
                                                    onChange={(e) => setNewComment(e.target.value)}
                                                    required 
                                                />
                                            </div>

                                            <button type="submit" className="btn-submit-review" disabled={submittingReview}>
                                                {submittingReview ? "Submitting..." : "Submit Review"}
                                            </button>
                                        </form>
                                    </div>
                                )}

                                {/* REVIEWS LIST */}
                                {loadingReviews ? (
                                    <div className="reviews-loading">Loading verified customer reviews...</div>
                                ) : reviews.length === 0 ? (
                                    <div className="no-reviews">No reviews available yet.</div>
                                ) : (
                                    <div className="inline-reviews-grid">
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
