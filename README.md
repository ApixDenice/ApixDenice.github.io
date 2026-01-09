# ApixDenice.github.io

Personal website showcasing iOS and macOS applications built with Jekyll and the Hacker theme.

## 🚀 Features

- **Modern Design**: Tech-inspired hacker theme with smooth animations
- **Responsive**: Works perfectly on all devices
- **Navigation**: Easy access to all sections via top menu bar
- **App Showcases**: Dedicated pages for DIPS and Office Mom apps
- **Contact Links**: Direct links to email, LinkedIn, and GitHub

## 📋 Setup Instructions

### 1. Add App Logos

Add your app logos to the `assets/images/` directory:

- `dips-logo.png` - DIPS app logo (recommended: 240x240px or higher, PNG format)
- `office-mom-logo.png` - Office Mom app logo (recommended: 240x240px or higher, PNG format)

The logos will automatically display on the home page. If images are not found, emoji fallbacks will be used.

### 2. Contact Page

The contact page includes direct links to:
- Email: dennishasselbusch@icloud.com
- LinkedIn: https://www.linkedin.com/in/dennis-hasselbusch-7512391b5/
- GitHub: https://github.com/ApixDenice

No additional setup required for the contact page.

### 3. GitHub Pages Deployment

1. Push all files to your `ApixDenice.github.io` repository
2. Go to repository Settings → Pages
3. Select the main branch as the source
4. GitHub Pages will automatically build and deploy your site

### 4. Local Development

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
│   ├── images/
│   │   ├── dips-logo.png        # DIPS app logo (add your image)
│   │   └── office-mom-logo.png  # Office Mom app logo (add your image)
│   └── js/
│       └── main.js      # Interactive JavaScript
├── index.md             # Home page
├── dips.md              # DIPS app page
├── office-mom.md        # Office Mom app page
└── contact.md           # Contact page with social links
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
- **Vanilla JavaScript**: For interactions and animations
- **CSS3**: Modern animations and responsive design

## 📝 Design Recommendations

See `DESIGN_RECOMMENDATIONS.md` for comprehensive design improvement suggestions and enhancements.

## 📝 License

This project is open source and available under the MIT License.

## 📧 Contact

For questions or suggestions, reach out via the contact page or email: dennishasselbusch@icloud.com
