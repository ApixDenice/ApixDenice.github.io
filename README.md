# ApixDenice.github.io

Personal website showcasing iOS and macOS applications built with Jekyll and the Hacker theme.

## 🚀 Features

- **Modern Design**: Tech-inspired hacker theme with smooth animations
- **Responsive**: Works perfectly on all devices
- **Navigation**: Easy access to all sections via top menu bar
- **App Showcases**: Dedicated pages for DIPS and Office Mom apps
- **Contact Form**: Integrated contact form for inquiries

## 📋 Setup Instructions

### 1. Contact Form Setup

The contact form uses Formspree to send emails. To set it up:

1. Sign up for a free account at [Formspree.io](https://formspree.io)
2. Create a new form
3. Set the recipient email to: `dennishasselbusch@icloud.com`
4. Set the subject to: `Website request`
5. Copy your form endpoint URL (e.g., `https://formspree.io/f/xxxxxxxxxx`)
6. Open `contact.md` and replace `YOUR_FORM_ID` in the form action URL with your Formspree form ID

### 2. GitHub Pages Deployment

1. Push all files to your `ApixDenice.github.io` repository
2. Go to repository Settings → Pages
3. Select the main branch as the source
4. GitHub Pages will automatically build and deploy your site

### 3. Local Development

To test locally:

```bash
# Install Jekyll (if not already installed)
gem install bundler jekyll

# Install dependencies
bundle install

# Run local server
bundle exec jekyll serve

# Visit http://localhost:4000
```

## 📁 Project Structure

```
.
├── _config.yml          # Jekyll configuration
├── _layouts/
│   └── default.html     # Main layout with navigation
├── assets/
│   ├── css/
│   │   └── custom.css   # Custom styles and animations
│   └── js/
│       └── main.js      # Interactive JavaScript
├── index.md             # Home page
├── dips.md              # DIPS app page
├── office-mom.md        # Office Mom app page
└── contact.md           # Contact page with form
```

## 🎨 Customization

### Colors

The theme uses a green-on-black hacker aesthetic. You can customize colors in `assets/css/custom.css`:

```css
:root {
  --primary-green: #00ff00;
  --accent-yellow: #ffff00;
  --bg-dark: #0d1117;
  /* ... */
}
```

### Content

- Edit `index.md` for the home page
- Edit `dips.md` for DIPS app information
- Edit `office-mom.md` for Office Mom app information
- Edit `contact.md` for contact page content

## 🔧 Technologies Used

- **Jekyll**: Static site generator
- **Hacker Theme**: GitHub Pages theme
- **Formspree**: Contact form backend
- **Vanilla JavaScript**: For interactions and animations
- **CSS3**: Modern animations and responsive design

## 📝 License

This project is open source and available under the MIT License.

## 📧 Contact

For questions or suggestions, reach out via the contact form on the website or email: dennishasselbusch@icloud.com
