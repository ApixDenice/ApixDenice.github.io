// Stripe onboarding return page (/dips/zahlungen/): ?status=refresh shows "link expired".
(function () {
    if (new URLSearchParams(location.search).get("status") !== "refresh") return;
    document.querySelector(".z-done").hidden = true;
    document.querySelector(".z-refresh").hidden = false;
  })();
