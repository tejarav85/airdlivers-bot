import { useState, useEffect } from "react";

const API = window.location.port === "3000" ? "http://localhost:8080" : "";

export default function MyServices({ token, onBack }) {
    const [data, setData] = useState({ senders: [], travelers: [] });
    const [loading, setLoading] = useState(true);

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
        if (item.deliveryCompleted) return "Delivered / Completed";
        if (item.deliveryPendingApproval) return "Picked up & Travelling";
        if (item.matchedWith) return "Match Confirmed";
        if (item.status === 'Approved') return "Approved / Waiting for match";
        if (item.status === 'Rejected') return "Rejected";
        return "Requested";
    };

    const getStatusColor = (item) => {
        if (item.deliveryCompleted) return "#28a745";
        if (item.deliveryPendingApproval) return "#17a2b8";
        if (item.matchedWith) return "#20c997";
        if (item.status === 'Approved') return "#007bff";
        if (item.status === 'Rejected') return "#dc3545";
        return "#ffc107";
    };

    return (
        <div style={{ maxWidth: 800, margin: "0 auto", padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>📋 My Services</h2>
                <button
                    onClick={onBack}
                    style={{ padding: "8px 15px", backgroundColor: "#6c757d", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer" }}
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

                    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: "300px" }}>
                            <h3>📦 Sender Requests</h3>
                            {data.senders.length > 0 ? (
                                data.senders.map(s => (
                                    <div key={s.requestId} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 15, marginBottom: 10, backgroundColor: "#f9f9f9" }}>
                                        <div style={{ fontWeight: "bold", fontSize: 18, color: "#007bff" }}>Request ID: {s.requestId}</div>
                                        <div style={{ marginTop: 8 }}>
                                            <strong>Route:</strong> {s.data?.pickup || '?'} ➡️ {s.data?.destination || '?'}
                                        </div>
                                        <div style={{ marginTop: 4 }}>
                                            <strong>Dates:</strong> {s.data?.sendDate || '?'} ➡️ {s.data?.arrivalDate || '?'}
                                        </div>
                                        <div style={{ marginTop: 4 }}>
                                            <strong>Status:</strong>{" "}
                                            <span style={{ color: getStatusColor(s), fontWeight: 'bold' }}>
                                                {getStatusText(s)}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p style={{ fontStyle: "italic", color: "gray" }}>No sender requests.</p>
                            )}
                        </div>

                        <div style={{ flex: 1, minWidth: "300px" }}>
                            <h3>🧳 Traveler Requests</h3>
                            {data.travelers.length > 0 ? (
                                data.travelers.map(t => (
                                    <div key={t.requestId} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 15, marginBottom: 10, backgroundColor: "#f9f9f9" }}>
                                        <div style={{ fontWeight: "bold", fontSize: 18, color: "#28a745" }}>Request ID: {t.requestId}</div>
                                        <div style={{ marginTop: 8 }}>
                                            <strong>Route:</strong> {t.data?.departure || '?'} ➡️ {t.data?.destination || '?'}
                                        </div>
                                        <div style={{ marginTop: 4 }}>
                                            <strong>Dates:</strong> {t.data?.departureTime || '?'} ➡️ {t.data?.arrivalTime || '?'}
                                        </div>
                                        <div style={{ marginTop: 4 }}>
                                            <strong>Status:</strong>{" "}
                                            <span style={{ color: getStatusColor(t), fontWeight: 'bold' }}>
                                                {getStatusText(t)}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p style={{ fontStyle: "italic", color: "gray" }}>No traveler requests.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
