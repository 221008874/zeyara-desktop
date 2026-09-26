import React from 'react';
import { Skeleton, TableCell, TableRow } from '@mui/material';

interface TableSkeletonProps {
  cols: number;
  rows?: number;
}

/**
 * Skeleton loading rows for a table body. Renders `rows` shimmering rows
 * matching a table with `cols` columns.
 */
export const TableSkeleton: React.FC<TableSkeletonProps> = ({ cols, rows = 5 }) => (
  <React.Fragment>
    {Array.from({ length: rows }).map((_, i) => (
      <TableRow key={i}>
        {Array.from({ length: cols }).map((__, j) => (
          <TableCell key={j}>
            <Skeleton width={j === 0 ? '60%' : j % 2 === 0 ? '45%' : '75%'} animation="wave" />
          </TableCell>
        ))}
      </TableRow>
    ))}
  </React.Fragment>
);
