import { useState, useEffect } from "react";
import Register from "./Register";
import Login from "./Login";
import Chat from "./Chat";
import SupportChat from "./SupportChat";
import Navbar from "./Navbar";
import MyServices from "./MyServices";
import HomePage from "./HomePage";
import { Star, CheckCircle2, X } from "lucide-react";

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [chatService, setChatService] = useState(localStorage.getItem("chatService") || null);
  const [page, setPage] = useState("home");
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [unreadSupport, setUnreadSupport] = useState(false);
  const [unreadService, setUnreadService] = useState(false);

  const [hasActiveRequest, setHasActiveRequest] = useState(false);
  const [activeServiceStat, setActiveServiceStat] = useState(null);
  const [chatKey, setChatKey] = useState(0);

  // Automated Post-Delivery Review Modal State
  const [completedServiceInfo, setCompletedServiceInfo] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewSubmittedSuccess, setReviewSubmittedSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
       setHasActiveRequest(false);
       setActiveServiceStat(null);
       setCompletedServiceInfo(null);
       return;
    }
    const interval = setInterval(async () => {
      try {
        const API = window.location.port === "3000" ? "http://localhost:8080" : "";
        const res = await fetch(`${API}/api/notifications/status`, {
          headers: { Authorization: token }
        });
        const data = await res.json();
        setUnreadSupport(data.unreadSupport);
        setUnreadService(data.unreadService);
        setHasActiveRequest(data.hasActiveRequest);
        setActiveServiceStat(data.activeService);

        // Check if there is a completed line (Sender -> Traveler -> Destination) awaiting review
        if (data.completedServiceInfo && !reviewSubmittedSuccess) {
            setCompletedServiceInfo(data.completedServiceInfo);
        }
      } catch (e) {}
    }, 5000);
    return () => clearInterval(interval);
  }, [token, reviewSubmittedSuccess]);

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("chatService");
    setToken(null);
    setChatService(null);
    setPage("home");
  };

  const handleNavClick = (s) => {
    if (s === "my_services") {
      setPage("my_services");
    } else if (s === "support") {
      if (token) {
        if (hasActiveRequest) {
          setShowSupport(true);
        } else {
          alert("The chat support team can assist you only when you have an active service request. Try sending an email at info@airdlivers.com");
        }
      } else {
        setShowLogin(true);
      }
    } else {
      setPage("home");
      if (s && s !== 'home') {
        setChatKey(prev => prev + 1);
        localStorage.setItem("chatService", s);
        setChatService(s);
      } else if (s === 'home') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setChatService(null);
        localStorage.removeItem("chatService");
      }
    }
  };

  const closeChat = () => {
    localStorage.removeItem("chatService");
    setChatService(null);
  };

  const handleSubmitCompletedReview = async (e) => {
    e.preventDefault();
    if (!reviewComment.trim() || !completedServiceInfo) return;

    setSubmittingReview(true);
    const API = window.location.port === "3000" ? "http://localhost:8080" : "";
    try {
      const authHeader = token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : '';
      const res = await fetch(`${API}/api/reviews/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeader ? { Authorization: authHeader } : {})
        },
        body: JSON.stringify({
          rating: reviewRating,
          comment: reviewComment.trim(),
          route: completedServiceInfo.route,
          role: completedServiceInfo.role,
          requestId: completedServiceInfo.requestId
        })
      });

      const data = await res.json();
      if (data.success) {
        setReviewSubmittedSuccess(true);
        setTimeout(() => {
          setCompletedServiceInfo(null);
          setReviewSubmittedSuccess(false);
          setReviewComment("");
          closeChat();
          setPage("home");
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 1400);
      }
    } catch (err) {
      console.error("Failed to submit review:", err);
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div>
      <Navbar
        token={token}
        openService={handleNavClick}
        logout={logout}
        openLogin={() => setShowLogin(true)}
        openRegister={() => setShowRegister(true)}
        navigateTo={handleNavClick}
        unreadSupport={unreadSupport}
        unreadService={unreadService}
        openSupportTab={() => {
           setShowSupport(true);
           setUnreadSupport(false);
        }}
        openServiceTab={() => {
           setShowSupport(false);
           setUnreadService(false);
           if (activeServiceStat) handleNavClick(activeServiceStat);
           else setPage('my_services');
        }}
      />

      {token && chatService && chatService !== "support" && (
        <Chat
          token={token}
          service={chatService}
          back={closeChat}
          chatKey={chatKey}
        />
      )}

      {token && showSupport && (
        <SupportChat
          token={token}
          back={() => setShowSupport(false)}
        />
      )}

      {page === 'my_services' && token && (
        <MyServices
          token={token}
          onBack={() => setPage("home")}
        />
      )}

      {showLogin && !token && (
        <Login
          setToken={(t) => {
            localStorage.setItem("token", t);
            setToken(t);
            setShowLogin(false);
          }}
          close={() => setShowLogin(false)}
          openRegister={() => {
            setShowLogin(false);
            setShowRegister(true);
          }}
        />
      )}

      {showRegister && !token && (
        <Register
          onRegistered={() => {
            setShowRegister(false);
            setShowLogin(true);
          }}
          close={() => setShowRegister(false)}
          openLogin={() => {
            setShowRegister(false);
            setShowLogin(true);
          }}
        />
      )}

      {/* AUTOMATED POST-DELIVERY FULL LIFECYCLE REVIEW MODAL */}
      {completedServiceInfo && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.8)",
          backdropFilter: "blur(8px)",
          zIndex: 3000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20
        }}>
          <div style={{
            backgroundColor: "#fff",
            borderRadius: 20,
            width: "100%",
            maxWidth: 500,
            padding: 30,
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.3)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 22, color: "#0f172a", fontWeight: 800 }}>🏁 Full Delivery Completed!</h3>
              <button onClick={() => setCompletedServiceInfo(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
                <X size={20} />
              </button>
            </div>

            {reviewSubmittedSuccess ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "#065f46" }}>
                <CheckCircle2 size={54} color="#10b981" style={{ margin: "0 auto 14px" }} />
                <h4 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700 }}>Thank you for your review!</h4>
                <p style={{ margin: 0, color: "#475569", fontSize: 16 }}>Your review is live. Redirecting to Home Page...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitCompletedReview} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ backgroundColor: "#f8fafc", padding: 14, borderRadius: 12, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>Completed Delivery Route</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{completedServiceInfo.route}</div>
                  <div style={{ fontSize: 13, color: "#007bff", marginTop: 4, fontWeight: 600 }}>
                    Role: {completedServiceInfo.role} • ID: {completedServiceInfo.requestId}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 14, fontWeight: 700, color: "#334155", display: "block", marginBottom: 8 }}>
                    How would you rate your delivery experience?
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {[1, 2, 3, 4, 5].map((val) => (
                      <Star
                        key={val}
                        size={32}
                        style={{ cursor: "pointer", transition: "transform 0.15s ease" }}
                        fill={(hoverRating || reviewRating) >= val ? "#f59e0b" : "none"}
                        color={(hoverRating || reviewRating) >= val ? "#f59e0b" : "#cbd5e1"}
                        onMouseEnter={() => setHoverRating(val)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => setReviewRating(val)}
                      />
                    ))}
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginLeft: 8 }}>{hoverRating || reviewRating} / 5 Stars</span>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 14, fontWeight: 700, color: "#334155", display: "block", marginBottom: 8 }}>
                    Your Experience & Comment *
                  </label>
                  <textarea
                    rows="4"
                    placeholder="Share how your package was handled from departure to final destination..."
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: 14,
                      borderRadius: 10,
                      border: "1.5px solid #cbd5e1",
                      fontSize: 15,
                      fontFamily: "inherit",
                      boxSizing: "border-box"
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingReview}
                  style={{
                    marginTop: 6,
                    width: "100%",
                    padding: 16,
                    backgroundColor: "#007bff",
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    fontWeight: "bold",
                    fontSize: 16,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(0,123,255,0.25)"
                  }}
                >
                  {submittingReview ? "Submitting..." : "Submit Review & Return to Home Page 🏠"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {page === 'home' && (
        <HomePage
          token={token}
          openLogin={() => setShowLogin(true)}
          navigateTo={handleNavClick}
        />
      )}
    </div>
  );
}