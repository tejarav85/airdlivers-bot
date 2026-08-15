import { useState, useEffect } from "react";
import { Star, CheckCircle2, X } from "lucide-react";

const API = window.location.port === "3000" ? "http://localhost:8080" : "";

export default function MyServices({ token, onBack }) {
    const [data, setData] = useState({ senders: [], travelers: [] });
    const [loading, setLoading] = useState(true);

    // Review Modal State for Completed Deliveries
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [rating, setRating] = useState(5);
    const [hoverRating, setHoverRating] = useState(0);
    const [comment, setComment] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);

    useEffect(() => {
        fetch(`${API}/api/my-services`, {
            headers: { Authorization: token }
        })
            .then(res => res.json())
            .then(d => {
                setData(d);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, [token]);

    const getStatusText = (item) => {
        if (item.deliveryCompleted || item.status === 'Completed') return "Delivered / Completed";
        if (item.deliveryPendingApproval) return "Picked up & Travelling";
        if (item.matchedWith) return "Match Confirmed";
        if (item.status === 'Approved') return "Approved / Waiting for match";
        if (item.status === 'Rejected') return "Rejected";
        return "Requested";
    };

    const getStatusColor = (item) => {
        if (item.deliveryCompleted || item.status === 'Completed') return "#28a745";
        if (item.deliveryPendingApproval) return "#17a2b8";
        if (item.matchedWith) return "#20c997";
        if (item.status === 'Approved') return "#007bff";
        if (item.status === 'Rejected') return "#dc3545";
        return "#ffc107";
    };

    const handleOpenReview = (item, role) => {
        const routeText = role === "Sender" 
            ? `${item.data?.pickup || 'Origin'} ✈️ ${item.data?.destination || 'Destination'}`
            : `${item.data?.departure || 'Origin'} ✈️ ${item.data?.destination || 'Destination'}`;

        setSelectedRequest({
            requestId: item.requestId,
            role,
            route: routeText
        });
        setRating(5);
        setComment("");
        setSubmitSuccess(false);
    };

    const handleSubmitReview = async (e) => {
        e.preventDefault();
        if (!comment.trim() || !selectedRequest) return;

        setSubmitting(true);
        try {
            const authHeader = token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : '';
            const res = await fetch(`${API}/api/reviews/submit`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(authHeader ? { Authorization: authHeader } : {})
                },
                body: JSON.stringify({
                    rating,
                    comment: comment.trim(),
                    route: selectedRequest.route,
                    role: selectedRequest.role,
                    requestId: selectedRequest.requestId
                })
            });

            const result = await res.json();
            if (result.success) {
                setSubmitSuccess(true);
                setTimeout(() => {
                    setSelectedRequest(null);
                    onBack(); // 🚀 Seamlessly return customer to Home Page!
                }, 1200);
            }
        } catch (err) {
            console.error("Failed to submit review:", err);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: 840, margin: "0 auto", padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <h2 style={{ fontSize: 28, margin: 0 }}>📋 My Services</h2>
                <button
                    onClick={onBack}
                    style={{ padding: "10px 18px", backgroundColor: "#007bff", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
                >
                    ⬅ Back to Home
                </button>
            </div>

            {loading ? (
                <p>Loading your requests...</p>
            ) : (
                <div>
                    {data.senders.length === 0 && data.travelers.length === 0 && (
                        <p style={{ fontStyle: "italic", color: "gray" }}>No services found.</p>
                    )}

                    <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                        {/* SENDER REQUESTS */}
                        <div style={{ flex: 1, minWidth: "320px" }}>
                            <h3 style={{ fontSize: 20, marginBottom: 16 }}>📦 Sender Requests</h3>
                            {data.senders.length > 0 ? (
                                data.senders.map(s => {
                                    const isCompleted = s.deliveryCompleted || s.status === 'Completed';
                                    return (
                                        <div key={s.requestId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginBottom: 14, backgroundColor: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
                                            <div style={{ fontWeight: "bold", fontSize: 18, color: "#007bff" }}>Request ID: {s.requestId}</div>
                                            <div style={{ marginTop: 8, fontSize: 15 }}>
                                                <strong>Route:</strong> {s.data?.pickup || '?'} ✈️ {s.data?.destination || '?'}
                                            </div>
                                            <div style={{ marginTop: 4, fontSize: 14, color: "#555" }}>
                                                <strong>Dates:</strong> {s.data?.sendDate || '?'} ➡️ {s.data?.arrivalDate || '?'}
                                            </div>
                                            <div style={{ marginTop: 6, fontSize: 14 }}>
                                                <strong>Status:</strong>{" "}
                                                <span style={{ color: getStatusColor(s), fontWeight: 'bold' }}>
                                                    {getStatusText(s)}
                                                </span>
                                            </div>

                                            {/* POST DELIVERY REVIEW OPTION */}
                                            {isCompleted && !s.reviewed && (
                                                <button
                                                    onClick={() => handleOpenReview(s, "Sender")}
                                                    style={{
                                                        marginTop: 14,
                                                        width: "100%",
                                                        padding: "10px 14px",
                                                        backgroundColor: "#10b981",
                                                        color: "#fff",
                                                        border: "none",
                                                        borderRadius: 8,
                                                        fontWeight: "bold",
                                                        fontSize: 14,
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        gap: 6
                                                    }}
                                                >
                                                    <Star size={16} fill="#fff" /> Submit Experience Review & Close
                                                </button>
                                            )}
                                            {isCompleted && s.reviewed && (
                                                <div style={{ marginTop: 10, fontSize: 13, color: "#10b981", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                                                    <CheckCircle2 size={16} /> Review Submitted
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <p style={{ fontStyle: "italic", color: "gray" }}>No sender requests.</p>
                            )}
                        </div>

                        {/* TRAVELER REQUESTS */}
                        <div style={{ flex: 1, minWidth: "320px" }}>
                            <h3 style={{ fontSize: 20, marginBottom: 16 }}>🧳 Traveler Requests</h3>
                            {data.travelers.length > 0 ? (
                                data.travelers.map(t => {
                                    const isCompleted = t.deliveryCompleted || t.status === 'Completed';
                                    return (
                                        <div key={t.requestId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginBottom: 14, backgroundColor: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
                                            <div style={{ fontWeight: "bold", fontSize: 18, color: "#28a745" }}>Request ID: {t.requestId}</div>
                                            <div style={{ marginTop: 8, fontSize: 15 }}>
                                                <strong>Route:</strong> {t.data?.departure || '?'} ✈️ {t.data?.destination || '?'}
                                            </div>
                                            <div style={{ marginTop: 4, fontSize: 14, color: "#555" }}>
                                                <strong>Dates:</strong> {t.data?.departureTime || '?'} ➡️ {t.data?.arrivalTime || '?'}
                                            </div>
                                            <div style={{ marginTop: 6, fontSize: 14 }}>
                                                <strong>Status:</strong>{" "}
                                                <span style={{ color: getStatusColor(t), fontWeight: 'bold' }}>
                                                    {getStatusText(t)}
                                                </span>
                                            </div>

                                            {/* POST DELIVERY REVIEW OPTION */}
                                            {isCompleted && !t.reviewed && (
                                                <button
                                                    onClick={() => handleOpenReview(t, "Traveler")}
                                                    style={{
                                                        marginTop: 14,
                                                        width: "100%",
                                                        padding: "10px 14px",
                                                        backgroundColor: "#10b981",
                                                        color: "#fff",
                                                        border: "none",
                                                        borderRadius: 8,
                                                        fontWeight: "bold",
                                                        fontSize: 14,
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        gap: 6
                                                    }}
                                                >
                                                    <Star size={16} fill="#fff" /> Submit Experience Review & Close
                                                </button>
                                            )}
                                            {isCompleted && t.reviewed && (
                                                <div style={{ marginTop: 10, fontSize: 13, color: "#10b981", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                                                    <CheckCircle2 size={16} /> Review Submitted
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <p style={{ fontStyle: "italic", color: "gray" }}>No traveler requests.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* POST DELIVERY REVIEW MODAL */}
            {selectedRequest && (
                <div style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "rgba(15, 23, 42, 0.75)",
                    backdropFilter: "blur(6px)",
                    zIndex: 2000,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 20
                }}>
                    <div style={{
                        backgroundColor: "#fff",
                        borderRadius: 16,
                        width: "100%",
                        maxWidth: 480,
                        padding: 26,
                        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, borderBottom: "1px solid #eee", paddingBottom: 12 }}>
                            <h3 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>🎉 Delivery Completed!</h3>
                            <button onClick={() => setSelectedRequest(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
                                <X size={20} />
                            </button>
                        </div>

                        {submitSuccess ? (
                            <div style={{ textTransform: "none", textAlign: "center", padding: "20px 0", color: "#065f46" }}>
                                <CheckCircle2 size={48} color="#10b981" style={{ margin: "0 auto 12px" }} />
                                <h4 style={{ margin: "0 0 6px", fontSize: 20 }}>Thank you for your review!</h4>
                                <p style={{ margin: 0, color: "#475569" }}>Returning to Home Page...</p>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmitReview} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <div>
                                    <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>Delivery Route</div>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{selectedRequest.route}</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: 14, fontWeight: 600, color: "#334155", display: "block", marginBottom: 6 }}>
                                        How was your overall experience?
                                    </label>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        {[1, 2, 3, 4, 5].map((val) => (
                                            <Star
                                                key={val}
                                                size={32}
                                                style={{ cursor: "pointer", transition: "transform 0.15s ease" }}
                                                fill={(hoverRating || rating) >= val ? "#f59e0b" : "none"}
                                                color={(hoverRating || rating) >= val ? "#f59e0b" : "#cbd5e1"}
                                                onMouseEnter={() => setHoverRating(val)}
                                                onMouseLeave={() => setHoverRating(0)}
                                                onClick={() => setRating(val)}
                                            />
                                        ))}
                                        <span style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginLeft: 8 }}>{hoverRating || rating} / 5 Stars</span>
                                    </div>
                                </div>

                                <div>
                                    <label style={{ fontSize: 14, fontWeight: 600, color: "#334155", display: "block", marginBottom: 6 }}>
                                        Your Review Comment *
                                    </label>
                                    <textarea
                                        rows="4"
                                        placeholder="Tell us about the delivery handover, communication, and speed..."
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                        required
                                        style={{
                                            width: "100%",
                                            padding: 12,
                                            borderRadius: 8,
                                            border: "1px solid #cbd5e1",
                                            fontSize: 15,
                                            fontFamily: "inherit",
                                            boxSizing: "border-box"
                                        }}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={submitting}
                                    style={{
                                        marginTop: 8,
                                        width: "100%",
                                        padding: 14,
                                        backgroundColor: "#007bff",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: 10,
                                        fontWeight: "bold",
                                        fontSize: 16,
                                        cursor: "pointer"
                                    }}
                                >
                                    {submitting ? "Submitting..." : "Submit Review & Return Home 🏠"}
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
