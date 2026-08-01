package social

const (
	xiangqiCols = 9
	xiangqiRows = 10
)

type xiangqiPieceType string

const (
	xiangqiRook     xiangqiPieceType = "R"
	xiangqiHorse    xiangqiPieceType = "H"
	xiangqiElephant xiangqiPieceType = "E"
	xiangqiAdvisor  xiangqiPieceType = "A"
	xiangqiKing     xiangqiPieceType = "K"
	xiangqiCannon   xiangqiPieceType = "C"
	xiangqiPawn     xiangqiPieceType = "P"
)

type xiangqiPiece struct {
	Color string
	Type  xiangqiPieceType
}

type xiangqiPosition struct {
	Col int
	Row int
}

type xiangqiMove struct {
	From xiangqiPosition
	To   xiangqiPosition
}

func xiangqiIndex(col, row int) int {
	return row*xiangqiCols + col
}

func xiangqiInside(col, row int) bool {
	return col >= 0 && col < xiangqiCols && row >= 0 && row < xiangqiRows
}

func xiangqiOpponent(color string) string {
	if color == "red" {
		return "black"
	}
	return "red"
}

func xiangqiInitialBoard() []*xiangqiPiece {
	board := make([]*xiangqiPiece, xiangqiCols*xiangqiRows)
	backRank := []xiangqiPieceType{
		xiangqiRook, xiangqiHorse, xiangqiElephant, xiangqiAdvisor, xiangqiKing,
		xiangqiAdvisor, xiangqiElephant, xiangqiHorse, xiangqiRook,
	}
	for col, pieceType := range backRank {
		board[xiangqiIndex(col, 0)] = &xiangqiPiece{Color: "black", Type: pieceType}
		board[xiangqiIndex(col, 9)] = &xiangqiPiece{Color: "red", Type: pieceType}
	}
	board[xiangqiIndex(1, 2)] = &xiangqiPiece{Color: "black", Type: xiangqiCannon}
	board[xiangqiIndex(7, 2)] = &xiangqiPiece{Color: "black", Type: xiangqiCannon}
	board[xiangqiIndex(1, 7)] = &xiangqiPiece{Color: "red", Type: xiangqiCannon}
	board[xiangqiIndex(7, 7)] = &xiangqiPiece{Color: "red", Type: xiangqiCannon}
	for col := 0; col < xiangqiCols; col += 2 {
		board[xiangqiIndex(col, 3)] = &xiangqiPiece{Color: "black", Type: xiangqiPawn}
		board[xiangqiIndex(col, 6)] = &xiangqiPiece{Color: "red", Type: xiangqiPawn}
	}
	return board
}

func xiangqiPieceAt(board []*xiangqiPiece, col, row int) *xiangqiPiece {
	if !xiangqiInside(col, row) {
		return nil
	}
	return board[xiangqiIndex(col, row)]
}

func xiangqiKingPosition(board []*xiangqiPiece, color string) (xiangqiPosition, bool) {
	for row := 0; row < xiangqiRows; row++ {
		for col := 0; col < xiangqiCols; col++ {
			piece := board[xiangqiIndex(col, row)]
			if piece != nil && piece.Color == color && piece.Type == xiangqiKing {
				return xiangqiPosition{Col: col, Row: row}, true
			}
		}
	}
	return xiangqiPosition{}, false
}

func xiangqiPseudoMoves(board []*xiangqiPiece, from xiangqiPosition) []xiangqiMove {
	piece := xiangqiPieceAt(board, from.Col, from.Row)
	if piece == nil {
		return nil
	}
	destinations := make([]xiangqiPosition, 0)
	switch piece.Type {
	case xiangqiRook:
		xiangqiCollectLine(board, from, 1, 0, piece.Color, &destinations)
		xiangqiCollectLine(board, from, -1, 0, piece.Color, &destinations)
		xiangqiCollectLine(board, from, 0, 1, piece.Color, &destinations)
		xiangqiCollectLine(board, from, 0, -1, piece.Color, &destinations)
	case xiangqiCannon:
		xiangqiCollectCannon(board, from, 1, 0, piece.Color, &destinations)
		xiangqiCollectCannon(board, from, -1, 0, piece.Color, &destinations)
		xiangqiCollectCannon(board, from, 0, 1, piece.Color, &destinations)
		xiangqiCollectCannon(board, from, 0, -1, piece.Color, &destinations)
	case xiangqiHorse:
		xiangqiCollectHorse(board, from, piece.Color, &destinations)
	case xiangqiElephant:
		xiangqiCollectElephant(board, from, piece.Color, &destinations)
	case xiangqiAdvisor:
		xiangqiCollectAdvisor(from, piece.Color, &destinations)
	case xiangqiKing:
		xiangqiCollectKing(board, from, piece.Color, &destinations)
	case xiangqiPawn:
		xiangqiCollectPawn(board, from, piece.Color, &destinations)
	}
	moves := make([]xiangqiMove, 0, len(destinations))
	for _, to := range destinations {
		target := xiangqiPieceAt(board, to.Col, to.Row)
		if target == nil || target.Color != piece.Color {
			moves = append(moves, xiangqiMove{From: from, To: to})
		}
	}
	return moves
}

func xiangqiLegalMoves(board []*xiangqiPiece, color string) []xiangqiMove {
	moves := make([]xiangqiMove, 0)
	for row := 0; row < xiangqiRows; row++ {
		for col := 0; col < xiangqiCols; col++ {
			piece := board[xiangqiIndex(col, row)]
			if piece == nil || piece.Color != color {
				continue
			}
			for _, move := range xiangqiPseudoMoves(board, xiangqiPosition{Col: col, Row: row}) {
				next := xiangqiApply(board, move)
				if !xiangqiInCheck(next, color) {
					moves = append(moves, move)
				}
			}
		}
	}
	return moves
}

func xiangqiApply(board []*xiangqiPiece, move xiangqiMove) []*xiangqiPiece {
	next := make([]*xiangqiPiece, len(board))
	copy(next, board)
	next[xiangqiIndex(move.To.Col, move.To.Row)] = next[xiangqiIndex(move.From.Col, move.From.Row)]
	next[xiangqiIndex(move.From.Col, move.From.Row)] = nil
	return next
}

func xiangqiInCheck(board []*xiangqiPiece, color string) bool {
	king, ok := xiangqiKingPosition(board, color)
	if !ok {
		return false
	}
	return xiangqiSquareAttacked(board, king.Col, king.Row, xiangqiOpponent(color))
}

func xiangqiGameResult(board []*xiangqiPiece, color string) (winner string, draw bool) {
	if len(xiangqiLegalMoves(board, color)) > 0 {
		return "", false
	}
	if xiangqiInCheck(board, color) {
		return xiangqiOpponent(color), false
	}
	return "", true
}

func xiangqiSquareAttacked(board []*xiangqiPiece, col, row int, byColor string) bool {
	if xiangqiFindRookAttack(board, col, row, byColor) {
		return true
	}
	if xiangqiFindCannonAttack(board, col, row, byColor) {
		return true
	}
	if xiangqiFindHorseAttack(board, col, row, byColor) {
		return true
	}
	if xiangqiFindPawnAttack(board, col, row, byColor) {
		return true
	}
	return xiangqiFindKingAttack(board, col, row, byColor)
}

func xiangqiFindRookAttack(board []*xiangqiPiece, col, row int, byColor string) bool {
	directions := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for _, direction := range directions {
		nextRow := row + direction[0]
		nextCol := col + direction[1]
		seen := 0
		for xiangqiInside(nextCol, nextRow) {
			piece := board[xiangqiIndex(nextCol, nextRow)]
			if piece != nil {
				seen++
				if seen == 1 {
					if piece.Color == byColor && piece.Type == xiangqiRook {
						return true
					}
					nextRow += direction[0]
					nextCol += direction[1]
					continue
				}
				if piece.Color == byColor && piece.Type == xiangqiRook {
					return true
				}
				break
			}
			nextRow += direction[0]
			nextCol += direction[1]
		}
	}
	return false
}

func xiangqiFindCannonAttack(board []*xiangqiPiece, col, row int, byColor string) bool {
	directions := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for _, direction := range directions {
		nextRow := row + direction[0]
		nextCol := col + direction[1]
		screen := 0
		for xiangqiInside(nextCol, nextRow) {
			piece := board[xiangqiIndex(nextCol, nextRow)]
			if piece != nil {
				screen++
				if screen == 1 {
					nextRow += direction[0]
					nextCol += direction[1]
					continue
				}
				if piece.Color == byColor && piece.Type == xiangqiCannon {
					return true
				}
				break
			}
			nextRow += direction[0]
			nextCol += direction[1]
		}
	}
	return false
}

func xiangqiFindHorseAttack(board []*xiangqiPiece, col, row int, byColor string) bool {
	steps := [8][4]int{
		{2, 1, 1, 0}, {2, -1, 1, 0}, {-2, 1, -1, 0}, {-2, -1, -1, 0},
		{1, 2, 0, 1}, {-1, 2, 0, 1}, {1, -2, 0, -1}, {-1, -2, 0, -1},
	}
	for _, step := range steps {
		legCol := col + step[2]
		legRow := row + step[3]
		if !xiangqiInside(legCol, legRow) || board[xiangqiIndex(legCol, legRow)] != nil {
			continue
		}
		horseCol := col + step[0]
		horseRow := row + step[1]
		if !xiangqiInside(horseCol, horseRow) {
			continue
		}
		horse := board[xiangqiIndex(horseCol, horseRow)]
		if horse != nil && horse.Color == byColor && horse.Type == xiangqiHorse {
			return true
		}
	}
	return false
}

func xiangqiFindPawnAttack(board []*xiangqiPiece, col, row int, byColor string) bool {
	forwardRow := row - 1
	if byColor == "red" {
		forwardRow = row + 1
	}
	candidates := []xiangqiPosition{{Col: col, Row: forwardRow}}
	if byColor == "black" && row <= 4 {
		candidates = append(candidates, xiangqiPosition{Col: col - 1, Row: row}, xiangqiPosition{Col: col + 1, Row: row})
	}
	if byColor == "red" && row >= 5 {
		candidates = append(candidates, xiangqiPosition{Col: col - 1, Row: row}, xiangqiPosition{Col: col + 1, Row: row})
	}
	for _, candidate := range candidates {
		if !xiangqiInside(candidate.Col, candidate.Row) {
			continue
		}
		piece := board[xiangqiIndex(candidate.Col, candidate.Row)]
		if piece != nil && piece.Color == byColor && piece.Type == xiangqiPawn {
			return true
		}
	}
	return false
}

func xiangqiFindKingAttack(board []*xiangqiPiece, col, row int, byColor string) bool {
	for nextRow := row + 1; nextRow < xiangqiRows; nextRow++ {
		piece := board[xiangqiIndex(col, nextRow)]
		if piece != nil {
			if piece.Color == byColor && piece.Type == xiangqiKing {
				return true
			}
			break
		}
	}
	for nextRow := row - 1; nextRow >= 0; nextRow-- {
		piece := board[xiangqiIndex(col, nextRow)]
		if piece != nil {
			if piece.Color == byColor && piece.Type == xiangqiKing {
				return true
			}
			break
		}
	}
	return false
}

func xiangqiCollectLine(board []*xiangqiPiece, from xiangqiPosition, rowStep, colStep int, color string, destinations *[]xiangqiPosition) {
	row := from.Row + rowStep
	col := from.Col + colStep
	for xiangqiInside(col, row) {
		piece := board[xiangqiIndex(col, row)]
		if piece == nil {
			*destinations = append(*destinations, xiangqiPosition{Col: col, Row: row})
		} else {
			if piece.Color != color {
				*destinations = append(*destinations, xiangqiPosition{Col: col, Row: row})
			}
			break
		}
		row += rowStep
		col += colStep
	}
}

func xiangqiCollectCannon(board []*xiangqiPiece, from xiangqiPosition, rowStep, colStep int, color string, destinations *[]xiangqiPosition) {
	row := from.Row + rowStep
	col := from.Col + colStep
	screen := 0
	for xiangqiInside(col, row) {
		piece := board[xiangqiIndex(col, row)]
		if piece == nil {
			if screen == 0 {
				*destinations = append(*destinations, xiangqiPosition{Col: col, Row: row})
			}
		} else {
			screen++
			if screen == 1 {
				row += rowStep
				col += colStep
				continue
			}
			if piece.Color != color {
				*destinations = append(*destinations, xiangqiPosition{Col: col, Row: row})
			}
			break
		}
		row += rowStep
		col += colStep
	}
}

func xiangqiCollectHorse(board []*xiangqiPiece, from xiangqiPosition, color string, destinations *[]xiangqiPosition) {
	steps := [8][4]int{
		{2, 1, 1, 0}, {2, -1, 1, 0}, {-2, 1, -1, 0}, {-2, -1, -1, 0},
		{1, 2, 0, 1}, {-1, 2, 0, 1}, {1, -2, 0, -1}, {-1, -2, 0, -1},
	}
	for _, step := range steps {
		legCol := from.Col + step[2]
		legRow := from.Row + step[3]
		if !xiangqiInside(legCol, legRow) || board[xiangqiIndex(legCol, legRow)] != nil {
			continue
		}
		targetCol := from.Col + step[0]
		targetRow := from.Row + step[1]
		if !xiangqiInside(targetCol, targetRow) {
			continue
		}
		target := board[xiangqiIndex(targetCol, targetRow)]
		if target == nil || target.Color != color {
			*destinations = append(*destinations, xiangqiPosition{Col: targetCol, Row: targetRow})
		}
	}
}

func xiangqiCollectElephant(board []*xiangqiPiece, from xiangqiPosition, color string, destinations *[]xiangqiPosition) {
	eye := 5
	if color == "black" {
		eye = 4
	}
	steps := [4][2]int{{2, 2}, {2, -2}, {-2, 2}, {-2, -2}}
	for _, step := range steps {
		targetCol := from.Col + step[0]
		targetRow := from.Row + step[1]
		eyeCol := from.Col + step[0]/2
		eyeRow := from.Row + step[1]/2
		if !xiangqiInside(targetCol, targetRow) || !xiangqiInside(eyeCol, eyeRow) {
			continue
		}
		if board[xiangqiIndex(eyeCol, eyeRow)] != nil {
			continue
		}
		if color == "red" && targetRow < eye {
			continue
		}
		if color == "black" && targetRow > eye {
			continue
		}
		target := board[xiangqiIndex(targetCol, targetRow)]
		if target == nil || target.Color != color {
			*destinations = append(*destinations, xiangqiPosition{Col: targetCol, Row: targetRow})
		}
	}
}

func xiangqiCollectAdvisor(from xiangqiPosition, color string, destinations *[]xiangqiPosition) {
	steps := [4][2]int{{1, 1}, {1, -1}, {-1, 1}, {-1, -1}}
	for _, step := range steps {
		targetCol := from.Col + step[0]
		targetRow := from.Row + step[1]
		if xiangqiInsidePalace(targetCol, targetRow, color) {
			*destinations = append(*destinations, xiangqiPosition{Col: targetCol, Row: targetRow})
		}
	}
}

func xiangqiCollectKing(board []*xiangqiPiece, from xiangqiPosition, color string, destinations *[]xiangqiPosition) {
	steps := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for _, step := range steps {
		targetCol := from.Col + step[0]
		targetRow := from.Row + step[1]
		if xiangqiInsidePalace(targetCol, targetRow, color) {
			*destinations = append(*destinations, xiangqiPosition{Col: targetCol, Row: targetRow})
		}
	}
}

func xiangqiCollectPawn(board []*xiangqiPiece, from xiangqiPosition, color string, destinations *[]xiangqiPosition) {
	forwardStep := -1
	if color == "black" {
		forwardStep = 1
	}
	forwardRow := from.Row + forwardStep
	if xiangqiInside(from.Col, forwardRow) {
		*destinations = append(*destinations, xiangqiPosition{Col: from.Col, Row: forwardRow})
	}
	crossed := color == "red" && from.Row < 5
	if color == "black" {
		crossed = from.Row > 4
	}
	if crossed {
		if from.Col > 0 {
			*destinations = append(*destinations, xiangqiPosition{Col: from.Col - 1, Row: from.Row})
		}
		if from.Col < xiangqiCols-1 {
			*destinations = append(*destinations, xiangqiPosition{Col: from.Col + 1, Row: from.Row})
		}
	}
}

func xiangqiInsidePalace(col, row int, color string) bool {
	if col < 3 || col > 5 {
		return false
	}
	if color == "red" {
		return row >= 7 && row <= 9
	}
	return row >= 0 && row <= 2
}
