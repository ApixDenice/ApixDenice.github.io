---
layout: default
title: Home
description: DIPS connects fitness enthusiasts through real sport events near you. Office Mom keeps your workday healthy. Made by ApixDenice.
---

<section class="hero">
  <div class="container hero-inner">
    <div class="hero-copy reveal">
      <span class="eyebrow">Move together, outdoors</span>
      <h1>Find your people. Start the workout.</h1>
      <p class="hero-lead">DIPS connects fitness enthusiasts through real sport events near you — discover sessions on a live map, join in, or host your own.</p>
      <div class="hero-actions">
        <a href="{{ "/dips" | relative_url }}" class="btn btn-primary btn-large">Explore DIPS</a>
        <a href="{{ "/dips/events" | relative_url }}" class="btn btn-outline btn-large">Create an event</a>
      </div>
      <p class="hero-note">Now you can create events from the web — they appear instantly in the DIPS app.</p>
    </div>
    <div class="hero-visual reveal">
      <div class="phone" aria-hidden="true">
        <div class="phone-screen">
          <div class="map-pin"><span class="dot">🏃</span><div><b>Morning run · 7:00</b><span>Stadtpark · 4 going</span></div></div>
          <div class="map-pin"><span class="dot">🧗</span><div><b>Bouldering meetup</b><span>Boulderhalle · 6 going</span></div></div>
          <div class="map-pin"><span class="dot">🚴</span><div><b>Sunday road ride</b><span>Elbe loop · 9 going</span></div></div>
          <div class="map-pin"><span class="dot">🏋️</span><div><b>Calisthenics</b><span>Outdoor gym · 3 going</span></div></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="section-head reveal">
      <h2>Two apps, one focus: a healthier you</h2>
      <p>Built natively for Apple platforms, designed to fit naturally into your day.</p>
    </div>
    <div class="apps-grid">
      <div class="app-card reveal" data-app="dips">
        <div class="app-logo-container">
          <img src="{{ '/assets/images/Dips .png' | relative_url }}" alt="DIPS app icon" class="app-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div class="app-icon" style="display:none;">🏃</div>
        </div>
        <h2>DIPS</h2>
        <p>A social sport &amp; fitness app for iPhone. Find events near you on a live map, join sessions, meet training partners, and host your own.</p>
        <a href="{{ "/dips" | relative_url }}" class="btn btn-primary">Learn more</a>
      </div>

      <div class="app-card reveal" data-app="office-mom">
        <div class="app-logo-container app-logo-dual">
          <img src="{{ '/assets/images/Office Mom.png' | relative_url }}" alt="Office Mom app icon" class="app-logo app-logo-dual-item" onerror="this.style.display='none';">
          <img src="{{ '/assets/images/iOffice Mom.png' | relative_url }}" alt="iOffice Mom app icon" class="app-logo app-logo-dual-item" onerror="this.style.display='none';">
          <div class="app-icon" style="display:none;">💧</div>
        </div>
        <h2>Office Mom &amp; iOffice Mom</h2>
        <p>Water, steps and a healthy 20-8-2 sit/stand/move rhythm — a Mac menu-bar companion plus its iPhone sibling.</p>
        <a href="{{ "/office-mom" | relative_url }}" class="btn btn-primary">Learn more</a>
      </div>
    </div>
  </div>
</section>

<section class="section section-tint">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow">How DIPS works</span>
      <h2>From "let's train" to training, in minutes</h2>
    </div>
    <div class="steps">
      <div class="step reveal"><div class="num"></div><h3>Discover nearby</h3><p>Open the live map and see sport events happening around you, filtered by activity.</p></div>
      <div class="step reveal"><div class="num"></div><h3>Join or host</h3><p>Tap to join a session, or create your own and set the sport, place, time and group size.</p></div>
      <div class="step reveal"><div class="num"></div><h3>Meet &amp; move</h3><p>Show up, train together, and grow your local fitness community session by session.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="cta-section reveal">
      <h2>Create events right from the web</h2>
      <p>Planning a series of sessions? Sign in with your DIPS account and add events from your browser — they sync straight into the app for everyone to find.</p>
      <div class="cta-button-row">
        <a href="{{ "/dips/events" | relative_url }}" class="btn btn-primary btn-large">Manage events</a>
        <a href="{{ "/dips" | relative_url }}" class="btn btn-outline btn-large">About DIPS</a>
      </div>
    </div>
  </div>
</section>
