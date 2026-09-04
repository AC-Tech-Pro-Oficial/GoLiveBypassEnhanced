try {
  var savedTheme = localStorage.getItem("golivebypass-theme");
  document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark";
} catch (_error) {
  document.documentElement.dataset.theme = "dark";
}
