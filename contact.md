---
layout: default
title: Contact
---

<div class="contact-page">
  <div class="contact-header">
    <h1>Get In Touch</h1>
    <p>Have a question or want to collaborate? Send me a message!</p>
  </div>

  <div class="contact-content">
    <!-- 
      IMPORTANT: Replace the form action URL with your Formspree endpoint
      1. Sign up at https://formspree.io (free tier available)
      2. Create a new form
      3. Set the recipient email to: dennishasselbusch@icloud.com
      4. Replace the action URL below with your Formspree form endpoint
    -->
    <form id="contact-form" class="contact-form" action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
      <input type="hidden" name="_subject" value="Website request">
      <input type="hidden" name="_next" value="{{ site.url }}/contact?success=true">
      
      <div class="form-group">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" required placeholder="Your name">
      </div>

      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required placeholder="your.email@example.com">
      </div>

      <div class="form-group">
        <label for="message">Message</label>
        <textarea id="message" name="message" rows="6" required placeholder="Your message here..."></textarea>
      </div>

      <button type="submit" class="btn-primary btn-large">
        <span class="btn-text">Send Message</span>
        <span class="btn-loader" style="display: none;">Sending...</span>
      </button>
    </form>

    <div id="form-status" class="form-status"></div>

    <div class="contact-info">
      <h3>Other Ways to Reach Me</h3>
      <div class="contact-links">
        <a href="mailto:dennishasselbusch@icloud.com" class="contact-link">
          <span class="contact-icon">✉️</span>
          dennishasselbusch@icloud.com
        </a>
      </div>
    </div>
  </div>
</div>
