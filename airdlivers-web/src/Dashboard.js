import { createSender } from "./api";

export default function Dashboard({ token, logout }) {

  const create = async () => {
    const res = await createSender(token, {
      pickup: "DXB",
      destination: "LHR",
      weight: 2
    });

    alert(JSON.stringify(res));
  };

  return (
    <div>
      <h2>Dashboard</h2>

      <button onClick={create}>Create Sender Test</button>

      <button onClick={logout}>Logout</button>
    </div>
  );
}