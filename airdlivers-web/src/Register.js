import { useState } from "react";
import { register } from "./api";

export default function Register({ onRegistered, close, openLogin }) {

  const [form, setForm] = useState({
    email: "",
    password: ""
  });

  const submit = async () => {
    const res = await register(form);
    if (res.success) {
      alert("Registered successfully!");
      onRegistered();
    } else {
      alert(res.error || "Registration failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={close}>&times;</button>
        <h2>Register</h2>
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
        <button className="modal-btn" onClick={submit}>Register</button>
        <p style={{ marginTop: 20 }}>
          Already have an account?
          <button className="modal-link-btn" onClick={openLogin}>Login</button>
        </p>
      </div>
    </div>
  );
}