import { useState } from "react";
import { login } from "./api";

export default function Login({ setToken, close, openRegister }) {
  const [form, setForm] = useState({ email: "", password: "" });

  const submit = async () => {
    const res = await login(form);
    if (res.token) {
      const fullToken = "Bearer " + res.token;
      localStorage.setItem("token", fullToken);
      setToken(fullToken);
    } else {
      alert(res.error || "Login failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={close}>&times;</button>
        <h2>Login</h2>
        <input
          className="modal-input"
          placeholder="Email"
          onChange={e => setForm({ ...form, email: e.target.value })}
        />
        <input
          className="modal-input"
          type="password"
          placeholder="Password"
          onChange={e => setForm({ ...form, password: e.target.value })}
        />
        <button className="modal-btn" onClick={submit}>Login</button>
        <p style={{ marginTop: 20 }}>
          Don't have an account?
          <button className="modal-link-btn" onClick={openRegister}>Register</button>
        </p>
      </div>
    </div>
  );
}