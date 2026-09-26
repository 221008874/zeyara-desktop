import React from 'react';
import { Drawer, List, ListItemButton, ListItemIcon, ListItemText, Box, Typography, IconButton, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import MenuIcon from '@mui/icons-material/Menu';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSettingsStore } from '../stores/settings';
import { useAuthStore } from '../stores/auth';
import { NAV_ITEMS, canAccess } from './navigation';

const DRAWER_WIDTH = 260;
const DRAWER_WIDTH_COLLAPSED = 68;

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {} = useSettingsStore();
  const { session } = useAuthStore();

  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('lg'));
  const [collapsed, setCollapsed] = React.useState(narrow);

  React.useEffect(() => {
    setCollapsed(narrow);
  }, [narrow]);

  // Role lists live in ./navigation so the sidebar and the router cannot disagree.
  // A missing role filters everything out rather than showing everything.
  const filteredItems = NAV_ITEMS.filter((item) => canAccess(item.path, session?.role));

  const width = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH;

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        transition: 'width 0.2s ease',
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          borderLeft: '1px solid',
          borderColor: 'divider',
          overflowX: 'hidden',
          transition: 'width 0.2s ease',
        },
      }}
    >
      <Box sx={{ p: collapsed ? 1 : 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {!collapsed && (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', whiteSpace: 'nowrap' }}>
              زيارة
            </Typography>
            {session && (
              <Typography variant="caption" color="text.secondary">
                {session.username} ({session.role})
              </Typography>
            )}
          </Box>
        )}
        <Tooltip title={collapsed ? 'توسيع' : 'طي'} arrow>
          <IconButton size="small" onClick={() => setCollapsed((c) => !c)} sx={{ mr: collapsed ? 'auto' : 0 }}>
            {collapsed ? <MenuIcon fontSize="small" /> : <MenuOpenIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      <List>
        {filteredItems.map((item) => (
          <Tooltip key={item.path} title={collapsed ? item.label : ''} placement="left" arrow>
            <ListItemButton
              selected={location.pathname === item.path || location.pathname.startsWith(item.path + '/')}
              onClick={() => navigate(item.path)}
              sx={{
                borderRadius: 1,
                mb: 0.5,
                mx: collapsed ? 0.5 : 0,
                justifyContent: collapsed ? 'center' : 'flex-start',
                '&.Mui-selected': {
                  backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                  color: (theme) => theme.palette.text.primary,
                  fontWeight: 700,
                },
                '&.Mui-selected:hover': {
                  backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: 'center' }}>
                <item.icon fontSize="small" />
              </ListItemIcon>
              {!collapsed && <ListItemText primary={item.label} />}
            </ListItemButton>
          </Tooltip>
        ))}
      </List>
    </Drawer>
  );
};

