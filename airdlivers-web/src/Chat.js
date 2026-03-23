import { useState, useEffect, useRef } from "react";

const API = window.location.port === "3000" ? "http://localhost:8080" : "";

export default function Chat({ token, service, logout, back, chatKey }) {

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isMatched, setIsMatched] = useState(false);
  const [isMinimized, setIsMinimized] = useState(!service);
  const [activeService, setActiveService] = useState(service);

  const chatEndRef = useRef(null);

  // ---------------- START CHAT ----------------
  useEffect(() => {
    if (service) {
      setIsMinimized(false);
    }
  }, [service, chatKey]);

  useEffect(() => {
    if (service) {
      start();
    }
  }, [service]); // eslint-disable-line

  const start = async (restart = false) => {
    try {

      const res = await fetch(`${API}/api/chat/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token
        },
        body: JSON.stringify({ service, restart })
      });

      const data = await res.json();

      if (data.error) {
        alert(data.error);
        back();
        return;
      }
      if (data.history) {
        setMessages(data.history);
      } else if (data.reply) {
        setMessages([
          { from: "bot", text: data.reply, photo: data.photo || null }
        ]);
      }

      if (data.activeService) {
        setActiveService(data.activeService);
      } else {
        setActiveService(service);
      }

      if (data.isMatched !== undefined) setIsMatched(data.isMatched);

    } catch (err) {
      console.log("START ERROR", err);
    }
  };

  // ---------------- AUTO SCROLL ----------------
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ---------------- POLLING ----------------
  useEffect(() => {

    const interval = setInterval(async () => {

      try {

        const res = await fetch(`${API}/api/chat/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: token
          },
          body: JSON.stringify({ message: "" })
        });

        const data = await res.json();

        if (data.reply) {
          setMessages(prev => [
            ...prev,
            { from: "bot", text: data.reply, buttons: data.buttons || null, photo: data.photo || null }
          ]);
        }

        if (data.activeService) {
          setActiveService(data.activeService);
        }

        if (data.isMatched !== undefined) setIsMatched(data.isMatched);

      } catch (e) { }

    }, 4000);

    return () => clearInterval(interval);

  }, [token]);

  // ---------------- SEND TEXT ----------------
  const send = async () => {

    if (!input.trim()) return;

    const userMsg = input;

    setMessages(prev => [
      ...prev,
      { from: "user", text: userMsg }
    ]);

    setInput("");

    try {

      const res = await fetch(`${API}/api/chat/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token
        },
        body: JSON.stringify({ message: userMsg })
      });

      const data = await res.json();

      if (data.reply) {
        setMessages(prev => [
          ...prev,
          { from: "bot", text: data.reply, buttons: data.buttons || null, photo: data.photo || null }
        ]);
      }

      if (data.activeService) {
        setActiveService(data.activeService);
      }

      if (data.isMatched !== undefined) setIsMatched(data.isMatched);

    } catch (err) {
      console.log("SEND ERROR", err);
    }
  };

  // ---------------- BUTTON CALLBACK ----------------
  const sendCallback = async (value) => {

    try {

      const res = await fetch(`${API}/api/chat/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token
        },
        body: JSON.stringify({ message: value })
      });

      const data = await res.json();

      if (data.reply) {
        setMessages(prev => [
          ...prev,
          { from: "bot", text: data.reply, buttons: data.buttons || null, photo: data.photo || null }
        ]);
      }

      if (data.activeService) {
        setActiveService(data.activeService);
      }

      if (data.isMatched !== undefined) setIsMatched(data.isMatched);

    } catch (err) {
      console.log("CALLBACK ERROR", err);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      width: '350px',
      height: isMinimized ? '45px' : '550px',
      backgroundColor: '#fff',
      border: '1px solid rgba(0,0,0,0.1)',
      borderRadius: '12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      overflow: 'hidden',
      transition: 'height 0.3s ease'
    }}>
      <div style={{
        backgroundColor: 'rgba(52, 152, 219, 0.85)',
        color: '#fff',
        padding: '12px 15px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer'
      }} onClick={() => setIsMinimized(!isMinimized)}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold' }}>
          {(activeService === "sender" || (!activeService && service === "sender")) && "Sender Chat"}
          {(activeService === "traveler" || (!activeService && service === "traveler")) && "Traveler Chat"}
          {activeService === "support" && "AirDlivers Support"}
          {!activeService && !service && "AirDlivers Chat"}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {activeService && activeService !== "support" && !isMatched && (
            <button
              onClick={(e) => { e.stopPropagation(); start(true); }}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer', marginRight: '10px' }}
              title="Restart Flow"
            >
              🔄
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer', marginRight: '5px' }}
            title="Minimize Chat"
          >
            {isMinimized ? '▲' : '▼'}
          </button>
          <button
            onClick={(e) => { 
              e.stopPropagation(); 
              if (messages.length > 1 && !isMinimized) {
                setIsMinimized(true);
              } else {
                back(); 
              }
            }}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer', paddingLeft: '8px', borderLeft: '1px solid rgba(255,255,255,0.3)' }}
            title="Close Chat"
          >
            ✖
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>


          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "15px",
            backgroundColor: "#f9f9fc"
          }}>

            {messages.length === 0 && !service && (
              <div style={{ textAlign: "center", marginTop: "50px", color: "#666" }}>
                Please select a service from the menu to begin.
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: m.from === "bot" ? "flex-start" : "flex-end",
                marginBottom: 12
              }}>
                <div style={{
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius: m.from === "bot" ? "14px 14px 14px 0" : "14px 14px 0 14px",
                  backgroundColor: m.from === "bot" ? "#fff" : "#0084ff",
                  color: m.from === "bot" ? "#333" : "#fff",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                  fontSize: "14px",
                  lineHeight: "1.4"
                }}>
                  {m.photo && (
                    <img 
                      src={m.photo.includes('ngrok-free.dev') ? m.photo.replace(/^https?:\/\/[^\/]+/, API) : m.photo} 
                      alt="Msg Attach" 
                      style={{ maxWidth: '100%', borderRadius: '8px', marginBottom: '8px', display: 'block' }} 
                      onError={(e) => {
                         console.warn("Image load failed:", m.photo);
                         // e.target.style.display = 'none'; // Don't hide for now so we can see it
                      }}
                    />
                  )}
                  <span dangerouslySetInnerHTML={{ __html: (m.text || "").replace(/\n/g, "<br/>") }} />

                  {m.buttons && m.buttons.map((row, r) => (
                    <div key={r} style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                      {row.map(btn => (
                        <button
                          key={btn.callback_data}
                          onClick={() => sendCallback(btn.callback_data)}
                          style={{
                            padding: "8px",
                            backgroundColor: "#f0f2f5",
                            border: "1px solid #ddd",
                            borderRadius: "8px",
                            cursor: "pointer",
                            fontWeight: "500",
                            color: "#0084ff"
                          }}
                        >
                          {btn.text}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div ref={chatEndRef}></div>

          </div>

          <div style={{ padding: '12px', borderTop: '1px solid #ebebeb', backgroundColor: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>

              <label title="Attach Document" style={{ cursor: "pointer", marginRight: "10px", fontSize: '20px', padding: '5px', borderRadius: '50%', color: '#65676b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                📎
                <input
                  type="file"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const formData = new FormData();
                    formData.append("photo", file);
                    const res = await fetch(`${API}/api/chat/photo`, {
                      method: "POST",
                      headers: { Authorization: token },
                      body: formData
                    });
                    const data = await res.json();
                    const localUrl = URL.createObjectURL(file);
                    setMessages(prev => [
                      ...prev,
                      { from: "user", text: "📷 Photo uploaded", photo: localUrl },
                      { from: "bot", text: data.reply, buttons: data.buttons || null }
                    ]);
                  }}
                />
              </label>

              {isMatched && (
                <button
                  onClick={() => sendCallback("ui_delivered")}
                  title="Mark Delivered"
                  style={{
                    background: "transparent",
                    color: "#28a745",
                    fontSize: "20px",
                    border: "none",
                    cursor: "pointer",
                    marginRight: "10px",
                    padding: "5px"
                  }}>
                  📦
                </button>
              )}

              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' ? send() : null}
                placeholder="Aa"
                style={{ flex: 1, padding: "10px 15px", borderRadius: "20px", border: "1px solid #ccd0d5", backgroundColor: '#f0f2f5', outline: 'none', fontSize: '14px' }}
              />

              <button
                onClick={send}
                style={{ background: "transparent", border: "none", color: "#0084ff", fontWeight: "bold", fontSize: "15px", marginLeft: "10px", cursor: "pointer", padding: "5px" }}
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}