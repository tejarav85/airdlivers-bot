import { useState, useEffect, useRef } from "react";

const API = window.location.port === "3000" ? "http://localhost:8080" : "";

export default function SupportChat({ token, back }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isMinimized, setIsMinimized] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const start = async () => {
      try {
        const res = await fetch(`${API}/api/chat/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: token
          },
          body: JSON.stringify({ service: "support" })
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
          setMessages([{ from: "bot", text: data.reply }]);
        }
      } catch (err) { 
        console.log("SUPPORT START ERROR", err); 
      }
    };
    start();
  }, [token, back]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/chat/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: token
          },
          body: JSON.stringify({ message: "", target: "support" })
        });
        const data = await res.json();
        if (data.reply) {
          setMessages(prev => [...prev, { from: "bot", text: data.reply }]);
        }
      } catch (e) { }
    }, 4000);
    return () => clearInterval(interval);
  }, [token]);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = input;
    setMessages(prev => [...prev, { from: "user", text: userMsg }]);
    setInput("");
    try {
      const res = await fetch(`${API}/api/chat/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token
        },
        body: JSON.stringify({ message: userMsg, target: "support" })
      });
      const data = await res.json();
      if (data.reply) {
         setMessages(prev => [...prev, { from: "bot", text: data.reply }]);
      }
    } catch (err) { 
      console.log("SUPPORT SEND ERROR", err); 
    }
  };

  const endChat = async () => {
    try {
      await fetch(`${API}/api/chat/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token
        },
        body: JSON.stringify({ message: "end chat", target: "support" })
      });
      back();
    } catch (e) { 
      back(); 
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '390px', 
      width: '320px',
      height: isMinimized ? '45px' : '480px',
      backgroundColor: '#fff',
      border: '1px solid rgba(0,0,0,0.1)',
      borderRadius: '12px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 2000,
      overflow: 'hidden',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        backgroundColor: '#2c3e50', 
        color: '#fff',
        padding: '12px 15px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
        userSelect: 'none'
      }} onClick={() => setIsMinimized(!isMinimized)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', backgroundColor: '#2ecc71', borderRadius: '50%' }}></div>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', letterSpacing: '0.3px' }}>Support Team</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: '12px', padding: '4px' }}>
            {isMinimized ? '▲' : '▼'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); back(); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: '20px', lineHeight: '1', padding: '0 4px' }} title="Minimize to Widget">
            ×
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <>
          <div style={{ 
            flex: 1, 
            overflowY: "auto", 
            padding: "15px", 
            backgroundColor: "#f8f9fa",
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {messages.map((m, i) => (
              <div key={i} style={{ 
                display: "flex", 
                flexDirection: 'column',
                alignItems: m.from === "bot" ? "flex-start" : "flex-end"
              }}>
                <div style={{
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius: m.from === "bot" ? "15px 15px 15px 2px" : "15px 15px 2px 15px",
                  backgroundColor: m.from === "bot" ? "#fff" : "#34495e",
                  color: m.from === "bot" ? "#2c3e50" : "#fff",
                  fontSize: "14px",
                  lineHeight: "1.5",
                  boxShadow: m.from === "bot" ? "0 2px 5px rgba(0,0,0,0.05)" : "0 2px 5px rgba(0,0,0,0.1)"
                }}>
                  <span dangerouslySetInnerHTML={{ __html: (m.text || "").replace(/\n/g, "<br/>") }} />
                </div>
                <span style={{ fontSize: '10px', color: '#95a5a6', marginTop: '4px', marginSide: '4px' }}>
                  {m.from === "bot" ? "Support" : "You"}
                </span>
              </div>
            ))}
            <div ref={chatEndRef}></div>
          </div>
          
          <div style={{ padding: '15px', backgroundColor: '#fff', borderTop: '1px solid #eee' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <input 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' ? send() : null} 
                placeholder="Message support..." 
                style={{ 
                  flex: 1, 
                  padding: "10px 12px", 
                  borderRadius: "20px", 
                  border: "1px solid #e1e8ed", 
                  fontSize: "13px",
                  outline: 'none',
                  backgroundColor: '#fdfdfd'
                }} 
              />
              <button 
                onClick={send} 
                style={{ 
                  background: "#3498db", 
                  color: "#fff", 
                  border: "none", 
                  borderRadius: "50%", 
                  width: '36px', 
                  height: '36px', 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s'
                }}
              >
                ➤
              </button>
            </div>
            <button 
              onClick={endChat} 
              style={{ 
                width: '100%', 
                background: '#fff', 
                border: '1px solid #ecf0f1', 
                color: '#e74c3c', 
                fontSize: '12px', 
                fontWeight: '600',
                padding: '8px', 
                cursor: 'pointer', 
                borderRadius: '6px',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#fff5f5'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#fff'}
            >
              End Chat Session
            </button>
          </div>
        </>
      )}
    </div>
  );
}
