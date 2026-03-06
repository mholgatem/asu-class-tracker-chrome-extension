// Toast notification handler — shown when seats open in a monitored class
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "SEATS_AVAILABLE") return;

  const existing = document.getElementById("asu-seat-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "asu-seat-toast";
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    background: #1b5e20;
    color: #fff;
    padding: 14px 18px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 14px;
    max-width: 320px;
    line-height: 1.5;
    cursor: pointer;
    border-left: 4px solid #4caf50;
    animation: asu-slide-in 0.3s ease;
  `;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes asu-slide-in {
      from { transform: translateX(120%); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
    @keyframes asu-slide-out {
      from { transform: translateX(0);   opacity: 1; }
      to   { transform: translateX(120%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  const count = msg.count;
  const title = msg.classTitle || "your class";
  toast.innerHTML = `
    <strong style="font-size:15px;">Seat${count !== 1 ? "s" : ""} Available!</strong><br>
    <span><em>${title}</em> now has ${count} seat${count !== 1 ? "s" : ""} open</span><br>
    <span style="font-size:11px;color:#a5d6a7;margin-top:4px;display:block;">Click to dismiss</span>
  `;

  function dismiss() {
    toast.style.animation = "asu-slide-out 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }

  toast.addEventListener("click", dismiss);
  const timer = setTimeout(dismiss, 10000);
  toast.addEventListener("click", () => clearTimeout(timer), { once: true });

  document.body.appendChild(toast);
});
