import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './video.css';
import { Video } from './Video';

createRoot(document.getElementById('root')!).render(<Video />);
