import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/manrope';
import './style.css';
import App from './App';
import { DownloadGuide, NotFound, ProfilesGuide, ShaftGuide } from './components/Guides';
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/htd-profiles" element={<ProfilesGuide />} />
      <Route path="/d-shaft" element={<ShaftGuide />} />
      <Route path="/download" element={<DownloadGuide />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>,
);
