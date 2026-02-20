const response = await fetch("http://localhost:3000/api/users/register", {
  method: "POST",
  body: JSON.stringify({
    name: "Bun User",
    email: "bun@example.com",
    password: "password123"
  }),
  headers: { "Content-Type": "application/json" },
});

console.log(await response.json());