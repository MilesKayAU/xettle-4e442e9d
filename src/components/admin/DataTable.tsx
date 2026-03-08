
import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, Download, ChevronUp, ChevronDown, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';

interface DataTableProps {
  data: any[];
  headers: string[];
  title?: string;
  columnTypes?: { [key: string]: any };
  onExport?: () => void;
}

export default function DataTable({ data, headers, title, columnTypes, onExport }: DataTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterColumn, setFilterColumn] = useState<string>('all');

  // Filter and search data
  const filteredData = useMemo(() => {
    return data.filter(row => {
      const searchMatch = searchTerm === '' || 
        Object.values(row).some(value => 
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        );

      const columnMatch = filterColumn === 'all' || 
        String(row[filterColumn]).toLowerCase().includes(searchTerm.toLowerCase());

      return searchMatch;
    });
  }, [data, searchTerm, filterColumn]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortColumn) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      
      // Handle numbers
      if (!isNaN(aVal) && !isNaN(bVal)) {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      // Handle strings
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      
      if (sortDirection === 'asc') {
        return aStr.localeCompare(bStr);
      } else {
        return bStr.localeCompare(aStr);
      }
    });
  }, [filteredData, sortColumn, sortDirection]);

  // Paginate data
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(sortedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Filtered Data');
    
    const fileName = `${title || 'data'}_filtered_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const getColumnTypeInfo = (column: string) => {
    if (!columnTypes || !columnTypes[column]) return null;
    return columnTypes[column];
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>{title || 'Data Table'}</CardTitle>
          <Button onClick={onExport || handleExport} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
        
        {/* Search and Filter Controls */}
        <div className="flex gap-4 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search data..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <Select value={filterColumn} onValueChange={setFilterColumn}>
            <SelectTrigger className="w-48">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by column" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All columns</SelectItem>
              {headers.map((header) => (
                <SelectItem key={header} value={header}>
                  {header}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={pageSize.toString()} onValueChange={(value) => setPageSize(Number(value))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Data Summary */}
        <div className="flex gap-4 text-sm text-gray-600">
          <span>Total: {data.length} records</span>
          <span>Filtered: {sortedData.length} records</span>
          <span>Showing: {paginatedData.length} records</span>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((header) => {
                  const typeInfo = getColumnTypeInfo(header);
                  return (
                    <TableHead key={header} className="font-medium">
                      <div className="space-y-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 font-medium"
                          onClick={() => handleSort(header)}
                        >
                          <span>{header}</span>
                          {sortColumn === header && (
                            sortDirection === 'asc' ? 
                              <ChevronUp className="ml-1 h-3 w-3" /> : 
                              <ChevronDown className="ml-1 h-3 w-3" />
                          )}
                        </Button>
                        {typeInfo && (
                          <div className="flex gap-1">
                            <Badge variant="outline" className="text-xs">
                              {typeInfo.type}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {typeInfo.purpose}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((row, index) => (
                <TableRow key={index}>
                  {headers.map((header) => (
                    <TableCell key={header} className="max-w-48">
                      <div className="truncate" title={String(row[header] || '')}>
                        {String(row[header] || '')}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-between items-center mt-4">
            <div className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
