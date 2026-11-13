import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './editor.css';
import { Editor } from './Editor';

createRoot(document.getElementById('root')!).render(<Editor />);
