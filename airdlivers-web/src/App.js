import { useState, useEffect } from "react";
import Register from "./Register";
import Login from "./Login";
import Chat from "./Chat";
import SupportChat from "./SupportChat";
import Navbar from "./Navbar";
import MyServices from "./MyServices";
import HomePage from "./HomePage";

function App() {
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

  useEffect(() => {
    if (!token) {
       setHasActiveRequest(false);
       setActiveServiceStat(null);
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
      } catch (e) {}
    }, 5000);
    return () => clearInterval(interval);
  }, [token]);

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

export default App;